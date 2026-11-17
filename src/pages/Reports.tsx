import { useState } from "react";
import { Ban, Calendar, Loader2, User } from "lucide-react";
import { Chips, DataTable, ErrorNote, Field, Modal, PageHead, StatusTag } from "../components/ui";
import type { Column } from "../components/ui";
import { pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { errorMessage, useAsync } from "../lib/useAsync";
import { formatDateTime, label, timeAgo } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";
import { useAuth } from "../lib/AuthContext";

type R = {
  ref_id: string; reporter_id: string; reported_id: string; booking_id: string | null; reason: string; details: string | null; status: string; admin_notes: string;
  created_at: string; reporter_name: string | null; reporter_email: string | null; reported_name: string | null; reported_email: string | null; reported_role: string | null; reported_suspended: boolean | null;
};

export default function Reports() {
  const [filter, setFilter] = useState("active"); const [page, setPage] = useState(0); const [open, setOpen] = useState<R | null>(null);
  const { data, loading, error, reload } = useAsync(() => pageQuery<R>("admin_reports", {
    page, order: [{ col: "created_at", asc: filter === "active" }],
    apply: (q: any) => (filter === "active" ? q.in("status", ["open", "investigating"]) : filter === "all" ? q : q.eq("status", filter)), // eslint-disable-line @typescript-eslint/no-explicit-any
  }), [page, filter]);

  const cols: Column<R>[] = [
    { key: "d", header: "Received", render: (r) => <span className="nowrap">{timeAgo(r.created_at)}</span> },
    { key: "why", header: "Reason", render: (r) => <div><div className="cellMain">{r.reason}</div><div className="cellSub clip" style={{ maxWidth: 340 }}>{r.details}</div></div> },
    { key: "by", header: "Reported by", render: (r) => <span className="clip">{r.reporter_name ?? "-"}</span> },
    { key: "on", header: "About", render: (r) => <div><div className="cellMain clip">{r.reported_name ?? "-"}</div><div className="cellSub">{label(r.reported_role)}</div></div> },
    { key: "s", header: "Status", render: (r) => <StatusTag status={r.status} /> },
  ];
  return (
    <>
      <PageHead title="Safety reports" subtitle="Reports people made about each other. Look at the facts, talk to both sides if needed, then record what you did." />
      <Chips value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[{ value: "active", label: "Needs action" }, { value: "actioned", label: "Actioned" }, { value: "dismissed", label: "Dismissed" }, { value: "all", label: "All" }]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(r) => r.ref_id} loading={loading} error={error} onRowClick={setOpen} page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage}
        empty={{ title: filter === "active" ? "No open reports" : "Nothing here" }} />
      {open && <ReportModal r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function ReportModal({ r, onClose, onSaved }: { r: R; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast(); const { admin } = useAuth(); const { openUser, openBooking } = useOverlay();
  const [status, setStatus] = useState(r.status); const [notes, setNotes] = useState(r.admin_notes ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const done = ["actioned", "dismissed"].includes(status);
      const { error: e } = await sb().from("user_reports").update({
        status, admin_notes: notes.trim(), resolved_by: done ? admin?.user_id : null, resolved_at: done ? new Date().toISOString() : null,
      }).eq("ref_id", r.ref_id);
      if (e) throw e;
      toast("Report updated."); onSaved();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }

  return (
    <Modal open wide title={r.reason} onClose={onClose}>
      <div className="compare" style={{ marginBottom: 16 }}>
        <div className="section"><h3>Reported by</h3><div className="cellMain">{r.reporter_name}</div><div className="cellSub">{r.reporter_email}</div>
          <button type="button" className="textButton" onClick={() => openUser(r.reporter_id)}><User size={14} /> Open profile</button></div>
        <div className="section"><h3>About {r.reported_suspended && <StatusTag status="suspended" />}</h3><div className="cellMain">{r.reported_name}</div><div className="cellSub">{r.reported_email} · {label(r.reported_role)}</div>
          <button type="button" className="textButton" onClick={() => openUser(r.reported_id)}><Ban size={14} /> Open profile to suspend</button></div>
      </div>
      <div className="section" style={{ marginBottom: 16 }}>
        <h3>What they said <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{formatDateTime(r.created_at)}</span></h3>
        <p style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.details || "No details given."}</p>
        {r.booking_id && <button type="button" className="outlineButton smallButton" style={{ marginTop: 12 }} onClick={() => openBooking(r.booking_id!)}><Calendar size={14} /> Open the booking</button>}
      </div>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="investigating">Investigating</option><option value="actioned">Actioned (we did something)</option><option value="dismissed">Dismissed (no action needed)</option>
        </select>
      </Field>
      <Field label="Internal notes" hint="Only admins see this. Record who you spoke to and what you decided."><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorNote message={err} />}
      <div className="modalActions">
        <button type="button" className="outlineButton" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="primaryButton" onClick={save} disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Save</button>
      </div>
    </Modal>
  );
}
