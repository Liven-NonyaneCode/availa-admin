import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Chips, DataTable, ErrorNote, Field, Modal, PageHead, StatusTag } from "../components/ui";
import type { Column } from "../components/ui";
import { mailto, pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { errorMessage, useAsync, useDebounced } from "../lib/useAsync";
import { formatDateTime, timeAgo } from "../lib/format";
import { useToast } from "../lib/Toast";
import { SearchBox } from "../components/ui";

type M = { message_id: string; user_id: string | null; name: string; email: string; subject: string; message: string; status: string; admin_notes: string; created_at: string };

export default function Support() {
  const [filter, setFilter] = useState("active"); const [q, setQ] = useState(""); const [page, setPage] = useState(0); const [open, setOpen] = useState<M | null>(null);
  const term = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => pageQuery<M>("support_messages", {
    page, order: [{ col: "created_at", asc: filter === "active" }], search: { cols: ["name", "email", "subject", "message"], term },
    apply: (query: any) => (filter === "active" ? query.in("status", ["new", "in_progress"]) : filter === "all" ? query : query.eq("status", filter)), // eslint-disable-line @typescript-eslint/no-explicit-any
  }), [page, filter, term]);

  const cols: Column<M>[] = [
    { key: "d", header: "Received", render: (m) => <span className="nowrap">{timeAgo(m.created_at)}</span> },
    { key: "f", header: "From", render: (m) => <div><div className="cellMain clip">{m.name}</div><div className="cellSub clip">{m.email}</div></div> },
    { key: "s", header: "Message", render: (m) => <div><div className="cellMain">{m.subject}</div><div className="cellSub clip" style={{ maxWidth: 360 }}>{m.message}</div></div> },
    { key: "st", header: "Status", render: (m) => <StatusTag status={m.status} /> },
  ];
  return (
    <>
      <PageHead title="Support inbox" subtitle="Messages from the Contact and Help pages. Reply by email, then update the status here." />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Name, email, subject or message" /></div>
      <Chips value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[{ value: "active", label: "To answer" }, { value: "new", label: "New" }, { value: "in_progress", label: "In progress" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(m) => m.message_id} loading={loading} error={error} onRowClick={setOpen} page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage}
        empty={{ title: filter === "active" ? "Inbox zero" : "No messages", text: filter === "active" ? "Nothing is waiting for an answer." : undefined }} />
      {open && <Thread m={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function Thread({ m, onClose, onSaved }: { m: M; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(m.status); const [notes, setNotes] = useState(m.admin_notes ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  async function save(next = status) {
    setBusy(true); setErr(null);
    try {
      const done = ["resolved", "closed"].includes(next);
      const { error: e } = await sb().from("support_messages").update({ status: next, admin_notes: notes.trim(), resolved_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("message_id", m.message_id);
      if (e) throw e;
      toast("Saved."); onSaved();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }

  return (
    <Modal open wide title={m.subject} onClose={onClose}>
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>From</dt><dd>{m.name} · {m.email}</dd><dt>Received</dt><dd>{formatDateTime(m.created_at)}</dd><dt>Has an account</dt><dd>{m.user_id ? "Yes (signed in when sending)" : "No / not signed in"}</dd>
      </dl>
      <div className="section" style={{ marginBottom: 16 }}><p style={{ lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.message}</p></div>
      <a className="primaryButton" style={{ marginBottom: 18 }} href={mailto(m.email, `Re: ${m.subject}`, `Hi ${m.name.split(" ")[0]},\n\n\n\nKind regards,\nAvaila Support`)} onClick={() => status === "new" && setStatus("in_progress")}><Mail size={16} /> Reply by email</a>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>
      </Field>
      <Field label="Internal notes" hint="Only admins see this."><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {err && <ErrorNote message={err} />}
      <div className="modalActions">
        <button type="button" className="outlineButton" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="primaryButton" onClick={() => void save()} disabled={busy}>{busy && <Loader2 size={15} className="spin" />} Save</button>
      </div>
    </Modal>
  );
}
