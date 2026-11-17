import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Chips, DataTable, PageHead, SearchBox, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { pageQuery, PAGE_SIZE } from "../lib/db";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDateTime, label } from "../lib/format";
import type { Tone } from "../lib/format";

type L = { id: number; created_at: string; actor_id: string | null; actor_name: string | null; actor_email: string | null; action: string; target_table: string | null; target_id: string | null; summary: string | null; detail: Record<string, unknown> };

const GROUPS: Record<string, string[]> = {
  accounts: ["suspend_user", "unsuspend_user", "send_password_reset", "list_artist", "unlist_artist", "remove_gallery_photo"],
  ids: ["view_id_photo", "id_approve", "id_reject", "id_resubmit"],
  money: ["retry_refunds", "settle_refund", "settle_payout", "cancel_booking", "mark_no_show"],
  privacy: ["read_chat", "export_users", "export_bookings", "export_payments"],
};
const toneOf = (a: string): Tone => (GROUPS.privacy.includes(a) || a === "view_id_photo" ? "amber" : GROUPS.money.includes(a) || a.startsWith("delete") ? "red" : a.startsWith("id_") ? "purple" : "grey");

export default function Audit() {
  const [q, setQ] = useState(""); const [group, setGroup] = useState("all"); const [page, setPage] = useState(0); const [openId, setOpenId] = useState<number | null>(null);
  const term = useDebounced(q);
  const { data, loading, error } = useAsync(() => pageQuery<L>("admin_audit", {
    page, order: [{ col: "created_at" }], search: { cols: ["action", "target_table", "target_id", "summary", "actor_name", "actor_email"], term },
    apply: (query: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (group === "changes") return query.in("action", ["insert", "update", "delete"]);
      if (GROUPS[group]) return query.in("action", GROUPS[group]);
      return query;
    },
  }), [page, term, group]);

  const cols: Column<L>[] = [
    { key: "t", header: "", width: 28, render: (l) => (openId === l.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />) },
    { key: "d", header: "When", render: (l) => <span className="nowrap">{formatDateTime(l.created_at)}</span> },
    { key: "w", header: "Who", render: (l) => <div><div className="cellMain">{l.actor_name ?? "System"}</div><div className="cellSub">{l.actor_email}</div></div> },
    { key: "a", header: "Action", render: (l) => <Tag tone={toneOf(l.action)}>{label(l.action)}</Tag> },
    { key: "s", header: "What", render: (l) => <div><div className="clip" style={{ maxWidth: 320 }}>{l.summary}</div><div className="cellSub mono clip" style={{ maxWidth: 320 }}>{l.target_table}{l.target_id ? ` · ${l.target_id}` : ""}</div></div> },
  ];

  return (
    <>
      <PageHead title="Audit log" subtitle="Everything an admin does is recorded here and can't be edited or deleted from this site." />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Admin, action or ID" /></div>
      <Chips value={group} onChange={(v) => { setGroup(v); setPage(0); }} options={[
        { value: "all", label: "Everything" }, { value: "accounts", label: "Accounts" }, { value: "ids", label: "ID checks" }, { value: "money", label: "Money and bookings" },
        { value: "privacy", label: "Private data access" }, { value: "changes", label: "Data changes" },
      ]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(l) => String(l.id)} loading={loading} error={error} onRowClick={(l) => setOpenId(openId === l.id ? null : l.id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "Nothing logged yet" }} />
      {openId !== null && data?.rows.find((l) => l.id === openId) && (
        <div className="section" style={{ marginTop: 16 }}>
          <h3>Details</h3>
          <pre className="jsonBox">{JSON.stringify(data.rows.find((l) => l.id === openId)!.detail, null, 2)}</pre>
        </div>
      )}
    </>
  );
}
