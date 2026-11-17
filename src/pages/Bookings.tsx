import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Chips, DataTable, PageHead, SearchBox, StatusTag, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { downloadCsv, logAction, pageQuery, PAGE_SIZE } from "../lib/db";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDate, formatMoney, formatTime, label } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";

type B = {
  booking_id: string; booking_date: string; start_time: string; status: string; price: number; amount_paid: number | null; deposit_amount: number | null;
  client_name: string; artist_name: string; service_name: string; session_started: boolean; is_house_call: boolean | null; cash_pending: boolean | null;
};

const STATUSES = ["awaiting_payment", "confirmed", "in_progress", "completed", "cancelled", "no_show", "expired", "declined", "pending"];

export default function Bookings() {
  const [params] = useSearchParams();
  const { openBooking } = useOverlay();
  const { toast } = useToast();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q);

  const apply = (query: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (status === "flagged") query = query.eq("status", "cancelled").eq("session_started", true);
    else if (status !== "all") query = query.eq("status", status);
    if (from) query = query.gte("booking_date", from);
    if (to) query = query.lte("booking_date", to);
    return query;
  };
  const cols = ["client_name", "artist_name", "client_email", "service_name"];
  const { data, loading, error } = useAsync(
    () => pageQuery<B>("admin_bookings", { page, order: [{ col: "booking_date" }, { col: "start_time" }], search: { cols, term }, apply }),
    [page, term, status, from, to],
  );

  async function exportCsv() {
    try {
      const all = await pageQuery<B>("admin_bookings", { page: 0, size: 5000, order: [{ col: "booking_date" }], search: { cols, term }, apply });
      downloadCsv("availa-bookings.csv", all.rows as unknown as Record<string, unknown>[], [
        { key: "booking_id", label: "Booking ID" }, { key: "booking_date", label: "Date" }, { key: "start_time", label: "Start" }, { key: "status", label: "Status" },
        { key: "service_name", label: "Service" }, { key: "client_name", label: "Client" }, { key: "artist_name", label: "Artist" }, { key: "price", label: "Price" }, { key: "amount_paid", label: "Paid" },
      ]);
      await logAction("export_bookings", "bookings", undefined, "Exported bookings to CSV", { rows: all.rows.length });
      toast(`Exported ${all.rows.length} bookings.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed.", "error");
    }
  }

  const columns: Column<B>[] = [
    { key: "when", header: "When", render: (b) => <div><div className="cellMain nowrap">{formatDate(b.booking_date)}</div><div className="cellSub">{formatTime(b.start_time)}</div></div> },
    { key: "svc", header: "Service", render: (b) => <span className="clip">{b.service_name}</span> },
    { key: "cl", header: "Client", render: (b) => <span className="clip">{b.client_name}</span> },
    { key: "ar", header: "Artist", render: (b) => <span className="clip">{b.artist_name}</span> },
    { key: "pr", header: "Price", align: "right", render: (b) => <span className="mono">{formatMoney(b.price)}</span> },
    { key: "pd", header: "Paid", align: "right", render: (b) => <span className="mono muted">{Number(b.deposit_amount ?? 0) > 0 ? formatMoney(b.amount_paid) : "-"}</span> },
    { key: "st", header: "Status", render: (b) => (
      <span className="rowActions">
        <StatusTag status={b.status} />
        {b.status === "cancelled" && b.session_started && <Tag tone="red">After start</Tag>}
        {b.cash_pending && <Tag tone="amber">Cash</Tag>}
      </span>
    ) },
  ];

  return (
    <>
      <PageHead title="Bookings" subtitle="Every appointment on the platform. Open one to see payments, refunds and to step in." actions={<button type="button" className="outlineButton" onClick={exportCsv}><Download size={16} /> Export CSV</button>} />
      <div className="toolbar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Client, artist, email or service" />
        <label className="srOnly" htmlFor="df">From</label>
        <input id="df" className="selectBox" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} title="From date" />
        <label className="srOnly" htmlFor="dt">To</label>
        <input id="dt" className="selectBox" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} title="To date" />
      </div>
      <Chips value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={[
        { value: "all", label: "All" },
        ...STATUSES.map((s) => ({ value: s, label: label(s) })),
        { value: "flagged", label: "Cancelled after start" },
      ]} />
      <DataTable columns={columns} rows={data?.rows} rowKey={(b) => b.booking_id} loading={loading} error={error} onRowClick={(b) => openBooking(b.booking_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No bookings match" }} />
    </>
  );
}
