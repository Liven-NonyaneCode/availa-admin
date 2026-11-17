// admin-id-review: a person on the team looks at an ID check the automatic system could not settle.
//
//   { action: "view",   request_id }
//        -> a 60-second link to the photo, plus what the artist typed and why it was flagged.
//   { action: "decide", request_id, decision: "approve" | "reject" | "resubmit",
//                       note?, block?: boolean, override?: boolean }
//
// Same promises as the automatic check (see the consent text in the Availa app):
//   * the photo is deleted the moment a decision is made
//   * typed name / date of birth / ID number are wiped at the same time
//   * only a scrambled fingerprint of the ID number is kept
// Every view and every decision is written to verification_events and the admin audit log.
// Needs the same secret as id-verify: ID_HMAC_KEY.
// Deploy with --no-verify-jwt. requireAdmin() checks the caller.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, audit, corsHeaders, errorResponse, isUuid, json, requireAdmin, serviceClient } from "../_shared/admin.ts";

const BUCKET = "id-uploads";
type Decision = "approve" | "reject" | "resubmit";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = serviceClient();
    const me = await requireAdmin(req, admin);
    const body = await req.json().catch(() => ({}));
    if (!isUuid(body.request_id)) throw new HttpError(400, "Missing request.");

    const { data: r } = await admin.from("verification_requests").select("*").eq("id", body.request_id).maybeSingle();
    if (!r) throw new HttpError(404, "That request doesn't exist.");
    if (r.status !== "needs_review") throw new HttpError(409, "This request isn't waiting for review any more.");

    if (body.action === "view") return await view(admin, me.id, r);
    if (body.action === "decide") {
      const decision = String(body.decision) as Decision;
      if (!["approve", "reject", "resubmit"].includes(decision)) throw new HttpError(400, "Unknown decision.");
      return await decide(admin, me.id, r, decision, String(body.note ?? "").trim().slice(0, 500), Boolean(body.block), Boolean(body.override));
    }
    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return errorResponse(err);
  }
});

async function view(admin: SupabaseClient, adminId: string, r: Record<string, any>) {
  if (!r.file_path) throw new HttpError(404, "The photo has already been deleted.");

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(r.file_path, 60);
  if (error || !data?.signedUrl) throw new HttpError(404, "We couldn't open the photo. It may have expired and been deleted.");

  await log(admin, r, "admin_viewed", {}, adminId);
  await audit(admin, adminId, "view_id_photo", "verification_requests", r.id, "Opened an ID photo for review");

  // What the automatic check found (flags and scores only; no personal details).
  const { data: ev } = await admin.from("verification_events").select("detail")
    .eq("request_id", r.id).eq("event", "sent_to_review").order("created_at", { ascending: false }).limit(1).maybeSingle();

  return json({
    url: data.signedUrl,
    expires_in: 60,
    doc_type: r.doc_type,
    typed: { full_name: r.typed_full_name, dob: r.typed_dob, id_number: r.typed_id_number },
    review_detail: ev?.detail ?? null,
  });
}

async function decide(
  admin: SupabaseClient, adminId: string, r: Record<string, any>,
  decision: Decision, note: string, block: boolean, override: boolean,
) {
  const now = new Date().toISOString();
  const fingerprint = r.typed_id_number ? await fingerprintOf(r.doc_type, r.typed_id_number) : null;

  if (decision === "approve") {
    if (fingerprint) {
      const { data: fp } = await admin.from("id_fingerprints").select("user_id, blocked").eq("id_hmac", fingerprint).maybeSingle();
      if (fp?.blocked) throw new HttpError(409, "This document is on the blocked list. It can't be approved.");
      if (fp && fp.user_id !== r.user_id && !override) {
        throw new HttpError(409, "This document is already linked to another account. Tick “Approve anyway” only if you are sure.");
      }
      await admin.from("id_fingerprints").upsert({ id_hmac: fingerprint, user_id: r.user_id }, { onConflict: "id_hmac", ignoreDuplicates: true });
    }
    await admin.from("artist_profiles")
      .update({ verification_status: "verified", verified_at: now, verification_method: "manual", is_listed: true })
      .eq("user_id", r.user_id);
    await close(admin, r, { status: "approved", method: "manual", reason_code: null, decided_at: now });
  }

  if (decision === "reject") {
    if (block && fingerprint) {
      await admin.from("id_fingerprints").upsert({ id_hmac: fingerprint, user_id: r.user_id, blocked: true }, { onConflict: "id_hmac" });
    }
    await admin.from("artist_profiles").update({ verification_status: "rejected", is_listed: false }).eq("user_id", r.user_id);
    await close(admin, r, { status: "rejected", method: "manual", reason_code: "manual_rejected", decided_at: now });
  }

  if (decision === "resubmit") {
    await admin.from("artist_profiles").update({ verification_status: "unverified" }).eq("user_id", r.user_id).eq("verification_status", "pending");
    await close(admin, r, { status: "resubmit", method: "manual", reason_code: "manual_resubmit", decided_at: now });
  }

  await log(admin, r, `decision_${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "resubmit"}`,
    { method: "manual", note: note || null, blocked: decision === "reject" && block }, adminId);
  await audit(admin, adminId, `id_${decision}`, "verification_requests", r.id,
    decision === "approve" ? "Approved an ID check" : decision === "reject" ? "Rejected an ID check" : "Asked for a new ID photo",
    { note: note || null, blocked: decision === "reject" && block });

  return json({ status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "resubmit" });
}

/** Deletes the photo through the Storage API, checks it is gone, and wipes the typed details. */
async function close(admin: SupabaseClient, r: Record<string, any>, fields: Record<string, unknown>) {
  let deleted = true;
  if (r.file_path) {
    const { error } = await admin.storage.from(BUCKET).remove([r.file_path]);
    const slash = r.file_path.lastIndexOf("/");
    const { data: left } = await admin.storage.from(BUCKET).list(r.file_path.slice(0, slash), { search: r.file_path.slice(slash + 1), limit: 1 });
    deleted = !error && !(left ?? []).some((f: { name: string }) => f.name === r.file_path.slice(slash + 1));
  }
  await admin.from("verification_requests").update({
    ...fields,
    typed_full_name: null, typed_dob: null, typed_id_number: null,
    // If the delete failed, keep the path so the scheduled cleanup (verify-cleanup) retries it.
    file_path: deleted ? null : r.file_path,
    file_deleted_at: deleted ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", r.id);
  await log(admin, r, deleted ? "image_deleted" : "image_delete_failed", {}, undefined);
}

async function log(admin: SupabaseClient, r: Record<string, any>, event: string, detail: Record<string, unknown>, actor?: string) {
  const { error } = await admin.from("verification_events")
    .insert({ request_id: r.id, user_id: r.user_id, event, detail, actor: actor ?? null });
  if (error) console.error("event insert failed:", error.message);
}

// Must match id-verify exactly, so the same document always produces the same fingerprint.
async function fingerprintOf(docType: string, idNumber: string): Promise<string> {
  const secret = Deno.env.get("ID_HMAC_KEY");
  if (!secret) throw new Error("ID_HMAC_KEY is not set");
  const message = `${docType === "sa_id" ? "sa_id" : "passport"}:${idNumber}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
