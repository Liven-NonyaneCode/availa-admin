import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, RefreshCw } from "lucide-react";
import { Chips, ConfirmModal, DataTable, Field, PageHead, SearchBox, StatusTag, Tabs, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { callFunction, downloadCsv, logAction, pageQuery, PAGE_SIZE } from "../lib/db";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDate, formatDateTime, formatMoney, label } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function Money() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "payments";
  const setTab = (t: string) => { const n = new URLSearchParams(params); n.set("tab", t); setParams(n); };
  return (
    <>
      <PageHead title="Money" subtitle="Card payments, refunds, payouts to artists and what Availa earns. Amounts are in rand." />
      <Tabs value={tab} onChange={setTab} options={[
        { value: "payments", label: "Payments" }, { value: "refunds", label: "Refunds" }, { value: "payouts", label: "Payouts" }, { value: "earnings", label: "Artist balances" },
      ]} />
      {tab === "payments" && <Payments />}
      {tab === "refunds" && <Refunds />}
      {tab === "payouts" && <Payouts />}
      {tab === "earnings" && <Earnings />}
    </>
  );
}

function Payments() {
  const { openBooking } = useOverlay();
  const { toast } = useToast();
  const [q, setQ] = useState(""); const [status, setStatus] = useState("all"); const [page, setPage] = useState(0);
  const term = useDebounced(q);
  const apply = (query: any) => (status === "all" ? query : query.eq("status", status)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const cols = ["reference", "client_name", "artist_name", "paystack_reference"];
  const { data, loading, error } = useAsync(() => pageQuery<Row>("admin_payments", { page, order: [{ col: "created_at" }], search: { cols, term }, apply }), [page, term, status]);

  async function exportCsv() {
    const all = await pageQuery<Row>("admin_payments", { page: 0, size: 5000, order: [{ col: "created_at" }], search: { cols, term }, apply });
    downloadCsv("availa-payments.csv", all.rows, [
      { key: "created_at", label: "Created" }, { key: "reference", label: "Reference" }, { key: "kind", label: "Kind" }, { key: "method", label: "Method" },
      { key: "amount", label: "Amount" }, { key: "currency", label: "Currency" }, { key: "status", label: "Status" }, { key: "client_name", label: "Client" }, { key: "artist_name", label: "Artist" },
    ]);
    await logAction("export_payments", "payments", undefined, "Exported payments to CSV", { rows: all.rows.length });
    toast(`Exported ${all.rows.length} payments.`);
  }

  const columns: Column<Row>[] = [
    { key: "d", header: "Created", render: (p) => <span className="nowrap">{formatDateTime(p.created_at)}</span> },
    { key: "k", header: "Payment", render: (p) => <div><div className="cellMain">{label(p.kind)} · {label(p.method)}</div><div className="cellSub mono clip">{p.reference}</div></div> },
    { key: "c", header: "Client", render: (p) => <span className="clip">{p.client_name ?? "-"}</span> },
    { key: "a", header: "Artist", render: (p) => <span className="clip">{p.artist_name ?? "-"}</span> },
    { key: "pv", header: "Provider", render: (p) => <Tag>{label(p.provider)}</Tag> },
    { key: "m", header: "Amount", align: "right", render: (p) => <span className="mono">{formatMoney(p.amount)}</span> },
    { key: "s", header: "Status", render: (p) => <StatusTag status={p.status} /> },
  ];
  return (
    <>
      <div className="toolbar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Reference, client or artist" />
        <button type="button" className="outlineButton" onClick={() => void exportCsv()}><Download size={16} /> Export CSV</button>
      </div>
      <Chips value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ value: "all", label: "All" }, ...["success", "pending", "failed", "cancelled", "refunded"].map((s) => ({ value: s, label: label(s) }))]} />
      <DataTable columns={columns} rows={data?.rows} rowKey={(p) => p.payment_id} loading={loading} error={error} onRowClick={(p) => openBooking(p.booking_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No payments match" }} />
    </>
  );
}

function Refunds() {
  const { openBooking } = useOverlay();
  const { toast } = useToast();
  const [status, setStatus] = useState("attention"); const [page, setPage] = useState(0);
  const [settle, setSettle] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState("true");
  const [retry, setRetry] = useState<Row | null>(null);

  const { data, loading, error, reload } = useAsync(() => pageQuery<Row>("admin_refunds", {
    page, order: [{ col: "created_at" }],
    apply: (q: any) => (status === "attention" ? q.in("status", ["due", "failed", "processing"]) : q), // eslint-disable-line @typescript-eslint/no-explicit-any
  }), [page, status]);

  const columns: Column<Row>[] = [
    { key: "d", header: "Created", render: (r) => <span className="nowrap">{formatDateTime(r.created_at)}</span> },
    { key: "r", header: "Reason", render: (r) => <div><div className="cellMain">{label(r.reason)}</div><div className="cellSub clip">{r.failure_reason ?? r.payment_reference ?? ""}</div></div> },
    { key: "c", header: "Client", render: (r) => <span className="clip">{r.client_name ?? "-"}</span> },
    { key: "a", header: "Artist", render: (r) => <span className="clip">{r.artist_name ?? "-"}</span> },
    { key: "m", header: "Amount", align: "right", render: (r) => <span className="mono">{formatMoney(r.amount)}</span> },
    { key: "s", header: "Status", render: (r) => <StatusTag status={r.status} /> },
    { key: "x", header: "", render: (r) => (
      ["due", "failed", "processing"].includes(String(r.status)) ? (
        <span className="rowActions" onClick={(e) => e.stopPropagation()}>
          {["due", "failed"].includes(String(r.status)) && <button type="button" className="primaryButton smallButton" onClick={() => setRetry(r)}><RefreshCw size={14} /> Send</button>}
          <button type="button" className="outlineButton smallButton" onClick={() => { setOutcome("true"); setSettle(r); }}>Settle by hand</button>
        </span>
      ) : null
    ) },
  ];

  return (
    <>
      <p className="muted" style={{ marginBottom: 14, maxWidth: 720, lineHeight: 1.55 }}>
        The database decides who is owed what. <strong>Send</strong> asks Paystack to pay it. A refund stuck on <em>Processing</em> means we couldn't confirm it reached Paystack. Check the Paystack dashboard first, then <strong>Settle by hand</strong>. Never resend a processing refund.
      </p>
      <Chips value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ value: "attention", label: "Needs attention" }, { value: "all", label: "All refunds" }]} />
      <DataTable columns={columns} rows={data?.rows} rowKey={(r) => r.refund_id} loading={loading} error={error} onRowClick={(r) => r.booking_id && openBooking(r.booking_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: status === "attention" ? "No refunds need attention" : "No refunds yet" }} />

      <ConfirmModal open={!!retry} title="Send this refund?" confirmLabel="Send refund" onClose={() => setRetry(null)}
        message={`Asks Paystack to send ${formatMoney(retry?.amount)} back to the client. It can't be sent twice.`}
        onConfirm={async () => {
          const r = await callFunction<{ processed: number; done: number; failed: number }>("admin-money", { action: "retry_refunds", booking_id: retry!.booking_id });
          toast(r.done ? "Refund sent." : r.processed ? "Paystack didn't accept it. See the reason on the row." : "Nothing was waiting for that booking.", r.done ? "success" : "error");
          reload();
        }} />
      <ConfirmModal open={!!settle} title="Settle this refund by hand" confirmLabel="Save outcome" minReason={5} reasonLabel="What did you check in Paystack?" onClose={() => setSettle(null)}
        onConfirm={async (reason) => {
          await callFunction("admin-money", { action: "settle_refund", refund_id: settle!.refund_id, ok: outcome === "true", reason });
          toast("Refund updated."); reload();
        }}>
        <Field label="What happened in Paystack?">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="true">The refund WAS sent</option>
            <option value="false">The refund was NOT sent</option>
          </select>
        </Field>
      </ConfirmModal>
    </>
  );
}

function Payouts() {
  const { toast } = useToast();
  const [status, setStatus] = useState("all"); const [page, setPage] = useState(0);
  const [settle, setSettle] = useState<Row | null>(null);
  const [outcome, setOutcome] = useState("success");
  const { data, loading, error, reload } = useAsync(() => pageQuery<Row>("admin_payouts", {
    page, order: [{ col: "created_at" }], apply: (q: any) => (status === "all" ? q : q.eq("status", status)), // eslint-disable-line @typescript-eslint/no-explicit-any
  }), [page, status]);

  const columns: Column<Row>[] = [
    { key: "d", header: "Requested", render: (p) => <span className="nowrap">{formatDateTime(p.created_at)}</span> },
    { key: "a", header: "Artist", render: (p) => <div><div className="cellMain clip">{p.artist_name ?? "-"}</div><div className="cellSub">{p.bank_name ? `${p.bank_name} ••••${p.account_last4}` : "No bank account on file"}</div></div> },
    { key: "m", header: "Amount", align: "right", render: (p) => <span className="mono">{formatMoney(p.amount)}</span> },
    { key: "s", header: "Status", render: (p) => <StatusTag status={p.status} /> },
    { key: "f", header: "Detail", render: (p) => <span className="clip muted" style={{ display: "block" }}>{p.failure_reason ?? (p.completed_at ? `Completed ${formatDate(p.completed_at)}` : "")}</span> },
    { key: "x", header: "", render: (p) => p.status === "processing" ? <button type="button" className="outlineButton smallButton" onClick={() => { setOutcome("success"); setSettle(p); }}>Settle by hand</button> : null },
  ];
  return (
    <>
      <p className="muted" style={{ marginBottom: 14, maxWidth: 720, lineHeight: 1.55 }}>
        Paystack's webhook normally finishes a payout within minutes. Only settle one by hand if it has been <em>Processing</em> for a long time and you have checked the transfer in the Paystack dashboard.
      </p>
      <Chips value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[{ value: "all", label: "All" }, ...["processing", "success", "failed", "reversed"].map((s) => ({ value: s, label: label(s) }))]} />
      <DataTable columns={columns} rows={data?.rows} rowKey={(p) => p.payout_id} loading={loading} error={error}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No payouts yet" }} />
      <ConfirmModal open={!!settle} title="Settle this payout by hand" confirmLabel="Save outcome" minReason={5} reasonLabel="What did you check in Paystack?" onClose={() => setSettle(null)}
        onConfirm={async (reason) => {
          await callFunction("admin-money", { action: "settle_payout", reference: settle!.reference, status: outcome, reason });
          toast("Payout updated."); reload();
        }}>
        <Field label="What happened in Paystack?" hint="Failed or reversed puts the money back in the artist's available balance.">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="success">The transfer WAS sent</option>
            <option value="failed">The transfer failed</option>
            <option value="reversed">The transfer was reversed</option>
          </select>
        </Field>
      </ConfirmModal>
    </>
  );
}

function Earnings() {
  const { openUser } = useOverlay();
  const [q, setQ] = useState(""); const [page, setPage] = useState(0);
  const term = useDebounced(q);
  const { data, loading, error } = useAsync(() => pageQuery<Row>("admin_artist_earnings", { page, order: [{ col: "net" }], search: { cols: ["artist_name"], term } }), [page, term]);
  const columns: Column<Row>[] = [
    { key: "a", header: "Artist", render: (r) => <span className="cellMain">{r.artist_name ?? "-"}</span> },
    { key: "g", header: "Card payments", align: "right", render: (r) => <span className="mono">{formatMoney(r.gross)}</span> },
    { key: "f", header: "Availa fee", align: "right", render: (r) => <span className="mono">{formatMoney(r.platform_fee)}</span> },
    { key: "h", header: "Held", align: "right", render: (r) => <span className="mono">{formatMoney(r.held)}</span> },
    { key: "av", header: "Available", align: "right", render: (r) => <span className="mono">{formatMoney(r.available)}</span> },
    { key: "ip", header: "In payout", align: "right", render: (r) => <span className="mono">{formatMoney(r.in_payout)}</span> },
    { key: "po", header: "Paid out", align: "right", render: (r) => <span className="mono">{formatMoney(r.paid_out)}</span> },
    { key: "rd", header: "Refund due", align: "right", render: (r) => Number(r.refund_due) > 0 ? <Tag tone="red">{formatMoney(r.refund_due)}</Tag> : <span className="muted mono">R0.00</span> },
  ];
  return (
    <>
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Artist" /></div>
      <DataTable columns={columns} rows={data?.rows} rowKey={(r) => r.artist_id} loading={loading} error={error} onRowClick={(r) => openUser(r.artist_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No earnings yet" }} />
    </>
  );
}
