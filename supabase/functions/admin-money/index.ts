// admin-money: the money actions only an admin can take.
//
//   { action: "retry_refunds", booking_id }
//        Sends any refund the database says the booking owes (same logic as the app,
//        without needing to be the client or artist). Safe to repeat: each refund is
//        claimed atomically so it can never be sent twice.
//   { action: "settle_refund", refund_id, ok, reason? }
//        Closes a refund stuck on "processing" or "failed" AFTER you checked it in the
//        Paystack dashboard. ok = true means "Paystack did send it".
//   { action: "settle_payout", reference, status: "success"|"failed"|"reversed", reason? }
//        Closes a payout stuck on "processing" AFTER you checked the transfer in Paystack.
//        "failed"/"reversed" returns the money to the artist's available balance.
//
// The database still decides who gets what; this only tells Paystack to send it or records the outcome.
// Deploy with --no-verify-jwt. requireAdmin() checks the caller.
import {
  HttpError, audit, corsHeaders, errorResponse, isUuid, json, paystack, requireAdmin, serviceClient, toCents,
} from "../_shared/admin.ts";

type ClaimedRefund = { refund_id: string; payment_id: string; amount: number | string; reason: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = serviceClient();
    const me = await requireAdmin(req, admin);
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason ?? "").trim().slice(0, 300);

    if (body.action === "retry_refunds") {
      if (!isUuid(body.booking_id)) throw new HttpError(400, "Missing booking.");
      const { data: claimed, error } = await admin.rpc("claim_refunds", { p_booking: body.booking_id });
      if (error) throw new Error(error.message);
      const refunds = (claimed ?? []) as ClaimedRefund[];

      let done = 0;
      let failed = 0;
      for (const r of refunds) {
        const { data: payment } = await admin.from("payments").select("*").eq("payment_id", r.payment_id).maybeSingle();
        const transaction = payment?.paystack_reference ?? payment?.reference;
        if (!transaction) {
          await admin.rpc("finish_refund", { p_refund_id: r.refund_id, p_ok: false, p_paystack_id: null, p_reason: "The payment has no Paystack reference." });
          failed++;
          continue;
        }
        let res;
        try {
          res = await paystack<{ id?: number | string }>("/refund", {
            method: "POST",
            body: {
              transaction,
              amount: toCents(Number(r.amount)),
              currency: "ZAR",
              customer_note: "Availa booking refund",
              merchant_note: `Availa refund (${r.reason}) for booking ${body.booking_id}, sent by an admin`,
            },
          });
        } catch (err) {
          // We can't tell whether Paystack received it. Leave it "processing" so it is NEVER sent twice.
          console.error("Refund call failed, left processing:", r.refund_id, err);
          failed++;
          continue;
        }
        if (res.ok) {
          await admin.rpc("finish_refund", { p_refund_id: r.refund_id, p_ok: true, p_paystack_id: res.data?.id != null ? String(res.data.id) : null, p_reason: null });
          done++;
        } else {
          await admin.rpc("finish_refund", { p_refund_id: r.refund_id, p_ok: false, p_paystack_id: null, p_reason: res.message || "Paystack refused the refund." });
          failed++;
        }
      }
      await audit(admin, me.id, "retry_refunds", "bookings", body.booking_id, "Retried refunds for a booking", { processed: refunds.length, done, failed });
      return json({ processed: refunds.length, done, failed });
    }

    if (body.action === "settle_refund") {
      if (!isUuid(body.refund_id)) throw new HttpError(400, "Missing refund.");
      if (reason.length < 5) throw new HttpError(400, "Please say what you checked in Paystack (at least 5 characters).");
      const { data: refund } = await admin.from("refunds").select("status").eq("refund_id", body.refund_id).maybeSingle();
      if (!refund) throw new HttpError(404, "That refund doesn't exist.");
      if (!["processing", "failed", "due"].includes(String(refund.status))) throw new HttpError(409, "This refund is already settled.");
      const ok = Boolean(body.ok);
      const { error } = await admin.rpc("finish_refund", {
        p_refund_id: body.refund_id, p_ok: ok, p_paystack_id: null,
        p_reason: ok ? null : reason,
      });
      if (error) throw new HttpError(400, error.message);
      await audit(admin, me.id, "settle_refund", "refunds", body.refund_id, ok ? "Marked a refund as sent" : "Marked a refund as failed", { reason, ok });
      return json({ status: ok ? "done" : "failed" });
    }

    if (body.action === "settle_payout") {
      const reference = String(body.reference ?? "");
      const status = String(body.status ?? "");
      if (!reference) throw new HttpError(400, "Missing payout.");
      if (!["success", "failed", "reversed"].includes(status)) throw new HttpError(400, "Unknown outcome.");
      if (reason.length < 5) throw new HttpError(400, "Please say what you checked in Paystack (at least 5 characters).");
      const { data: payout } = await admin.from("payouts").select("status").eq("reference", reference).maybeSingle();
      if (!payout) throw new HttpError(404, "That payout doesn't exist.");
      if (payout.status !== "processing") throw new HttpError(409, "Only payouts that are still processing can be settled by hand.");
      const { error } = await admin.rpc("finish_payout", { p_reference: reference, p_status: status, p_transfer_code: null, p_reason: reason });
      if (error) throw new HttpError(400, error.message);
      await audit(admin, me.id, "settle_payout", "payouts", reference, `Settled a payout as ${status}`, { reason, status });
      return json({ status });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return errorResponse(err);
  }
});
