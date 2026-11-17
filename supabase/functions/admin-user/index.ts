// admin-user: suspend / reinstate an account, or send a password reset email.
//
//   { action: "suspend",    user_id, reason }
//   { action: "unsuspend",  user_id }
//   { action: "send_reset", user_id }
//
// Suspending does three things: marks the profile, blocks the login at Supabase Auth
// (so the person cannot sign in or refresh a session), and takes an artist off the
// public directory. Nothing is deleted. Bookings, payments and reviews stay intact.
//
// Deploy with --no-verify-jwt. requireAdmin() checks the caller.
import { createClient } from "npm:@supabase/supabase-js@2";
import { HttpError, audit, corsHeaders, errorResponse, isUuid, json, requireAdmin, serviceClient } from "../_shared/admin.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = serviceClient();
    const me = await requireAdmin(req, admin);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const userId = body.user_id;
    if (!isUuid(userId)) throw new HttpError(400, "Missing user.");

    const { data: target } = await admin
      .from("profiles")
      .select("user_id, role, email, full_name, is_suspended")
      .eq("user_id", userId)
      .maybeSingle();
    if (!target) throw new HttpError(404, "That account doesn't exist.");

    if (action === "suspend") {
      if (target.user_id === me.id) throw new HttpError(400, "You can't suspend your own account.");
      if (target.role === "admin") throw new HttpError(400, "Admin accounts can't be suspended here. Change the role in the database first.");
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) throw new HttpError(400, "Please give a reason (at least 5 characters).");

      const now = new Date().toISOString();
      const { error } = await admin.from("profiles").update({
        is_suspended: true, suspended_at: now, suspended_reason: reason, suspended_by: me.id,
      }).eq("user_id", userId);
      if (error) throw new Error(error.message);

      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (banError) throw new Error(banError.message);

      if (target.role === "artist") {
        await admin.from("artist_profiles").update({ is_listed: false, is_available: false }).eq("user_id", userId);
      }
      await audit(admin, me.id, "suspend_user", "profiles", userId, "Suspended an account", { reason, role: target.role });
      return json({ status: "suspended" });
    }

    if (action === "unsuspend") {
      const { error } = await admin.from("profiles").update({
        is_suspended: false, suspended_at: null, suspended_reason: null, suspended_by: null,
      }).eq("user_id", userId);
      if (error) throw new Error(error.message);

      const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (banError) throw new Error(banError.message);

      // An artist only goes back on the directory if their ID check had already passed.
      if (target.role === "artist") {
        const { data: ap } = await admin.from("artist_profiles").select("verification_status").eq("user_id", userId).maybeSingle();
        if (ap?.verification_status === "verified") {
          await admin.from("artist_profiles").update({ is_listed: true }).eq("user_id", userId);
        }
      }
      await audit(admin, me.id, "unsuspend_user", "profiles", userId, "Reinstated an account", { role: target.role });
      return json({ status: "active" });
    }

    if (action === "send_reset") {
      if (!target.email) throw new HttpError(400, "This account has no email address.");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("APP_SUPABASE_KEY");
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, anonKey!, { auth: { persistSession: false } });
      const appUrl = (Deno.env.get("MAIN_APP_URL") ?? "").replace(/\/$/, "");
      const { error } = await anon.auth.resetPasswordForEmail(target.email, appUrl ? { redirectTo: `${appUrl}/reset-password` } : undefined);
      if (error) throw new HttpError(400, error.message);
      await audit(admin, me.id, "send_password_reset", "profiles", userId, "Sent a password reset email");
      return json({ status: "sent" });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return errorResponse(err);
  }
});
