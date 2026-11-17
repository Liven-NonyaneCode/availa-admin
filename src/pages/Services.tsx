import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmModal, DataTable, ErrorNote, Field, Modal, PageHead, SearchBox, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { logAction, pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { errorMessage, useAsync, useDebounced } from "../lib/useAsync";
import { useToast } from "../lib/Toast";

type S = { service_id: number; service_name: string; description: string; default_duration_minutes: number; artist_count: number; created_by: string | null; created_by_name: string | null };

export default function Services() {
  const { toast } = useToast();
  const [q, setQ] = useState(""); const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<Partial<S> | null>(null); const [del, setDel] = useState<S | null>(null);
  const term = useDebounced(q);
  const { data, loading, error, reload } = useAsync(() => pageQuery<S>("admin_services", { page, order: [{ col: "service_name", asc: true }], search: { cols: ["service_name", "description"], term } }), [page, term]);

  const cols: Column<S>[] = [
    { key: "n", header: "Service", render: (s) => <div><div className="cellMain">{s.service_name} {s.created_by && <Tag tone="blue">Added by an artist</Tag>}</div><div className="cellSub clip" style={{ maxWidth: 380 }}>{s.description}</div></div> },
    { key: "d", header: "Default length", render: (s) => `${s.default_duration_minutes} min` },
    { key: "a", header: "Artists offering it", align: "right", render: (s) => <span className="mono">{s.artist_count}</span> },
    { key: "b", header: "Created by", render: (s) => s.created_by_name ?? <span className="muted">Availa</span> },
    { key: "x", header: "", render: (s) => (
      <span className="rowActions">
        <button type="button" className="outlineButton smallButton" onClick={() => setEdit(s)}><Pencil size={14} /> Edit</button>
        <button type="button" className="outlineButton dangerButton smallButton" onClick={() => setDel(s)} aria-label={`Delete ${s.service_name}`}><Trash2 size={14} /></button>
      </span>
    ) },
  ];

  return (
    <>
      <PageHead title="Services" subtitle="The list artists pick from. Rename, fix or remove services, including ones artists added themselves."
        actions={<button type="button" className="primaryButton" onClick={() => setEdit({ service_name: "", description: "", default_duration_minutes: 60 })}><Plus size={16} /> Add service</button>} />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Service name" /></div>
      <DataTable columns={cols} rows={data?.rows} rowKey={(s) => String(s.service_id)} loading={loading} error={error} page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No services" }} />
      {edit && <EditService s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast("Service saved."); reload(); }} />}
      <ConfirmModal open={!!del} danger title={`Delete “${del?.service_name}”?`} confirmLabel="Delete service" minReason={5} onClose={() => setDel(null)}
        message={del && del.artist_count > 0 ? `${del.artist_count} artist(s) offer this. It will be removed from their profiles. A service with bookings can't be deleted; rename it instead.` : "Nobody offers this service."}
        onConfirm={async (reason) => {
          const { error: e } = await sb().from("services").delete().eq("service_id", del!.service_id);
          if (e) throw new Error(e.code === "23503" ? "This service has bookings, so it can't be deleted. Rename it instead." : e.message);
          await logAction("delete_service", "services", String(del!.service_id), "Deleted a service", { reason, name: del!.service_name });
          toast("Service deleted."); reload();
        }} />
    </>
  );
}

function EditService({ s, onClose, onSaved }: { s: Partial<S>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: s.service_name ?? "", desc: s.description ?? "", mins: String(s.default_duration_minutes ?? 60) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const mins = Number(f.mins);
  const valid = f.name.trim().length >= 2 && Number.isInteger(mins) && mins > 0 && mins <= 600;

  async function save() {
    setBusy(true); setErr(null);
    try {
      const row = { service_name: f.name.trim(), description: f.desc.trim(), default_duration_minutes: mins };
      const q = s.service_id ? sb().from("services").update(row).eq("service_id", s.service_id) : sb().from("services").insert(row);
      const { error: e } = await q;
      if (e) throw new Error(e.code === "23505" ? "A service with that name already exists." : e.message);
      onSaved();
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal open title={s.service_id ? "Edit service" : "Add service"} onClose={onClose}>
      <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><textarea value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} style={{ minHeight: 70 }} /></Field>
      <Field label="Default length (minutes)" hint="Artists can set their own length for each service."><input type="number" min={5} max={600} value={f.mins} onChange={(e) => setF({ ...f, mins: e.target.value })} /></Field>
      {err && <ErrorNote message={err} />}
      <div className="modalActions">
        <button type="button" className="outlineButton" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="primaryButton" onClick={save} disabled={busy || !valid}>Save service</button>
      </div>
    </Modal>
  );
}
