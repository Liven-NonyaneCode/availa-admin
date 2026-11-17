import { useState } from "react";
import { Ban, MessageSquare, RefreshCw, UserX } from "lucide-react";
import { ConfirmModal, Drawer, Empty, ErrorNote, Loading, StatusTag, Tag } from "./ui";
import { useAsync } from "../lib/useAsync";
import { callFunction, logAction, rpc } from "../lib/db";
import { sb } from "../lib/supabase";
import { formatDate, formatDateTime, formatMoney, formatTime, label, timeAgo } from "../lib/format";
import { useToast } from "../lib/Toast";
import { useOverlay } from "../lib/overlay";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Msg = { message_id: string; sender_id: string; sender_name: string; body: string; created_at: string };

const OPEN_STATUSES = ["awaiting_payment", "pending", "confirmed", "in_progress"];
const NEEDS_ATTENTION = ["due", "failed", "processing"];

export default function BookingDrawer({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { openUser } = useOverlay();
  const [confirm, setConfirm] = useState<null | "cancel" | "no_show" | "chat" | "refunds">(null);
  const [chat, setChat] = useState<Msg[] | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const client = sb();
    const { data: booking, error: e } = await client.from("admin_bookings").select("*").eq("booking_id", bookingId).maybeSingle();
    if (e) throw e;
    if (!booking) return null;
    const [pay, ref] = await Promise.all([
      client.from("admin_payments").select("payment_id, kind, method, provider, amount, status, reference, created_at").eq("booking_id", bookingId).order("created_at"),
      client.from("admin_refunds").select("refund_id, amount, reason, status, created_at").eq("booking_id", bookingId).order("created_at"),
    ]);
    return { b: booking as Row, payments: (pay.data ?? []) as Row[], refunds: (ref.data ?? []) as Row[] };
  }, [bookingId]);

  const b = data?.b;
  const deposit = Number(b?.deposit_amount ?? 0);
  const balance = b && deposit > 0 ? Math.max(0, Number(b.price) - Number(b.amount_paid ?? 0)) : 0;
  const refundsPending = (data?.refunds ?? []).some((r) => NEEDS_ATTENTION.includes(String(r.status)));
  const flagged = b?.status === "cancelled" && b?.session_started;

  async function cancel(reason: string) {
    const { error: e } = await sb().from("bookings").update({ status: "cancelled" }).eq("booking_id", bookingId);
    if (e) throw e;
    await logAction("cancel_booking", "bookings", bookingId, "Cancelled a booking", { reason });
    // The database works out any refund when a booking is cancelled. Send what it decided.
    try {
      const r = await callFunction<{ processed: number; done: number; failed: number }>("admin-money", { action: "retry_refunds", booking_id: bookingId });
      toast(r.processed > 0 ? `Booking cancelled. ${r.done} refund(s) sent, ${r.failed} need attention.` : "Booking cancelled. No refund was due.");
    } catch {
      toast("Booking cancelled. The refund couldn't be sent yet; retry it from here.", "error");
    }
    reload();
  }
  async function noShow(reason: string) {
    const { error: e } = await sb().from("bookings").update({ status: "no_show" }).eq("booking_id", bookingId);
    if (e) throw e;
    await logAction("mark_no_show", "bookings", bookingId, "Marked a booking as a no-show", { reason });
    toast("Marked as a no-show.");
    reload();
  }
  async function readChat(reason: string) {
    const rows = await rpc<Msg[]>("admin_booking_chat", { p_booking: bookingId, p_reason: reason });
    setChat(rows);
  }
  async function retryRefunds() {
    const r = await callFunction<{ processed: number; done: number; failed: number }>("admin-money", { action: "retry_refunds", booking_id: bookingId });
    toast(r.processed === 0 ? "Nothing to send: no refund is waiting." : `${r.done} refund(s) sent, ${r.failed} still need attention.`, r.failed ? "error" : "success");
    reload();
  }

  return (
    <Drawer open title="Booking" onClose={onClose}>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {!loading && !error && !b && <Empty title="Booking not found" />}

      {b && (
        <>
          <section className="section">
            <div className="rowActions" style={{ marginBottom: 14, alignItems: "center" }}>
              <StatusTag status={b.status} />
              {b.is_house_call && <Tag tone="blue">House call</Tag>}
              {b.cash_pending && <Tag tone="amber">Cash to confirm</Tag>}
            </div>
            {flagged && <div className="formMessage warn">Cancelled after the session had started. This should be reviewed.</div>}
            <dl className="kv">
              <dt>Service</dt><dd>{b.service_name}</dd>
              <dt>When</dt><dd>{formatDate(b.booking_date)}, {formatTime(b.start_time)}{b.end_time ? ` to ${formatTime(b.end_time)}` : ""}</dd>
              <dt>Client</dt><dd><button type="button" className="textButton" onClick={() => openUser(b.client_id)}>{b.client_name}</button> <span className="muted">{b.client_email}</span></dd>
              <dt>Artist</dt><dd><button type="button" className="textButton" onClick={() => openUser(b.artist_id)}>{b.artist_name}</button></dd>
              <dt>Price</dt><dd className="mono">{formatMoney(b.price)}</dd>
              {deposit > 0 && (<><dt>Deposit</dt><dd className="mono">{formatMoney(deposit)}</dd><dt>Paid so far</dt><dd className="mono">{formatMoney(b.amount_paid)}</dd><dt>Balance due</dt><dd className="mono">{formatMoney(balance)}</dd></>)}
              {b.status === "awaiting_payment" && b.hold_expires_at && (<><dt>Slot held until</dt><dd>{formatDateTime(b.hold_expires_at)}</dd></>)}
              {b.cancelled_by && (<><dt>Cancelled by</dt><dd>{label(b.cancelled_by)} {b.cancelled_at ? `· ${timeAgo(b.cancelled_at)}` : ""}</dd></>)}
              {b.is_house_call && b.house_call_address && (<><dt>Address</dt><dd>{b.house_call_address}</dd></>)}
              <dt>Client notes</dt><dd>{b.client_notes || "-"}</dd>
              <dt>Artist notes</dt><dd>{b.artist_notes || "-"}</dd>
              <dt>Created</dt><dd>{formatDateTime(b.created_at)}</dd>
              <dt>Booking ID</dt><dd className="mono muted" style={{ fontSize: 12 }}>{b.booking_id}</dd>
            </dl>
            <div className="rowActions" style={{ marginTop: 18 }}>
              {OPEN_STATUSES.includes(b.status) && <button type="button" className="outlineButton dangerButton smallButton" onClick={() => setConfirm("cancel")}><Ban size={15} /> Cancel booking</button>}
              {["confirmed", "in_progress"].includes(b.status) && <button type="button" className="outlineButton smallButton" onClick={() => setConfirm("no_show")}><UserX size={15} /> Mark no-show</button>}
              <button type="button" className="outlineButton smallButton" onClick={() => setConfirm("chat")}><MessageSquare size={15} /> Read chat</button>
            </div>
          </section>

          <section className="section">
            <h3>Payments</h3>
            {data!.payments.length === 0 ? <span className="muted">No payments for this booking.</span> : (
              <div className="miniList">
                {data!.payments.map((p) => (
                  <div key={p.payment_id} className="miniRow">
                    <div><div className="cellMain">{label(p.kind)} · {label(p.method)}</div><div className="cellSub mono">{p.reference}</div></div>
                    <div className="rowActions" style={{ alignItems: "center" }}><span className="mono">{formatMoney(p.amount)}</span><StatusTag status={p.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <h3>
              Refunds
              {refundsPending && <button type="button" className="primaryButton smallButton" onClick={() => setConfirm("refunds")}><RefreshCw size={14} /> Send refunds now</button>}
            </h3>
            {data!.refunds.length === 0 ? <span className="muted">No refunds on this booking.</span> : (
              <div className="miniList">
                {data!.refunds.map((r) => (
                  <div key={r.refund_id} className="miniRow">
                    <div><div className="cellMain">{label(r.reason)}</div><div className="cellSub">{formatDateTime(r.created_at)}</div></div>
                    <div className="rowActions" style={{ alignItems: "center" }}><span className="mono">{formatMoney(r.amount)}</span><StatusTag status={r.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {chat && (
            <section className="section">
              <h3>Private chat <Tag tone="amber">Access logged</Tag></h3>
              {chat.length === 0 ? <span className="muted">No messages.</span> : (
                <div className="stack" style={{ gap: 10 }}>
                  {chat.map((m) => (
                    <div key={m.message_id}>
                      <div className="chatMeta">{m.sender_name} · {formatDateTime(m.created_at)}</div>
                      <div className="chatBubble">{m.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmModal open={confirm === "cancel"} danger title="Cancel this booking?" confirmLabel="Cancel booking" minReason={5} onConfirm={cancel} onClose={() => setConfirm(null)}
        message="Both people see it as cancelled. Any refund the cancellation policy allows is worked out by the database and sent straight away." />
      <ConfirmModal open={confirm === "no_show"} title="Mark as a no-show?" confirmLabel="Mark no-show" minReason={5} onConfirm={noShow} onClose={() => setConfirm(null)} />
      <ConfirmModal open={confirm === "chat"} title="Read the private chat?" confirmLabel="Open chat" minReason={5} reasonLabel="Why do you need to read it?" onConfirm={readChat} onClose={() => setConfirm(null)}
        message="This chat is private between the client and the artist. Only open it to settle a dispute or a safety report. Your name and reason are saved in the audit log." />
      <ConfirmModal open={confirm === "refunds"} title="Send waiting refunds?" confirmLabel="Send refunds" onConfirm={retryRefunds} onClose={() => setConfirm(null)}
        message="The database decides who is owed what. This only tells Paystack to send it. It is safe to repeat: a refund can never be sent twice." />
    </Drawer>
  );
}
