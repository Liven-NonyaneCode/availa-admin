import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { Avatar, Chips, DataTable, PageHead, SearchBox, StatusTag, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { downloadCsv, logAction, pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDate, timeAgo } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";

type U = {
  user_id: string; role: string; full_name: string | null; email: string; phone: string | null; city: string | null; avatar_url: string | null;
  is_suspended: boolean; is_deactivated: boolean; created_at: string; last_sign_in_at: string | null; booking_count: number; reports_against: number; business_name: string | null;
};

const SEARCH = ["full_name", "email", "phone", "city", "business_name"];

export default function Users() {
  const [params] = useSearchParams();
  const { openUser } = useOverlay();
  const { toast } = useToast();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [role, setRole] = useState("all");
  const [state, setState] = useState("all");
  const [page, setPage] = useState(0);
  const term = useDebounced(q);

  const apply = (query: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (role !== "all") query = query.eq("role", role);
    if (state === "suspended") query = query.eq("is_suspended", true);
    if (state === "deactivated") query = query.eq("is_deactivated", true);
    if (state === "reported") query = query.gt("reports_against", 0);
    return query;
  };

  const { data, loading, error } = useAsync(
    () => pageQuery<U>("admin_users", { page, order: [{ col: "created_at" }], search: { cols: SEARCH, term }, apply }),
    [page, term, role, state],
  );

  async function exportCsv() {
    try {
      const all = await pageQuery<U>("admin_users", { page: 0, size: 5000, order: [{ col: "created_at" }], search: { cols: SEARCH, term }, apply });
      downloadCsv("availa-users.csv", all.rows as unknown as Record<string, unknown>[], [
        { key: "full_name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "role", label: "Role" },
        { key: "city", label: "City" }, { key: "created_at", label: "Joined" }, { key: "booking_count", label: "Bookings" },
      ]);
      await logAction("export_users", "profiles", undefined, "Exported users to CSV", { rows: all.rows.length });
      toast(`Exported ${all.rows.length} people.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed.", "error");
    }
  }
  void sb;

  const cols: Column<U>[] = [
    { key: "who", header: "Person", render: (u) => (
      <div className="cellPerson"><Avatar name={u.full_name} url={u.avatar_url} /><div><div className="cellMain clip">{u.full_name || "Unnamed"}</div><div className="cellSub clip">{u.email}</div></div></div>
    ) },
    { key: "role", header: "Role", render: (u) => <StatusTag status={u.role} /> },
    { key: "city", header: "City", render: (u) => u.city || "-" },
    { key: "joined", header: "Joined", render: (u) => <span className="nowrap">{formatDate(u.created_at)}</span> },
    { key: "seen", header: "Last sign-in", render: (u) => <span className="nowrap muted">{timeAgo(u.last_sign_in_at)}</span> },
    { key: "bk", header: "Bookings", align: "right", render: (u) => <span className="mono">{u.booking_count}</span> },
    { key: "flags", header: "Flags", render: (u) => (
      <span className="rowActions">
        {u.is_suspended && <StatusTag status="suspended" />}
        {u.is_deactivated && <StatusTag status="deactivated" />}
        {u.reports_against > 0 && <Tag tone="amber">{u.reports_against} report{u.reports_against > 1 ? "s" : ""}</Tag>}
      </span>
    ) },
  ];

  return (
    <>
      <PageHead title="Users" subtitle="Every client, artist and admin account." actions={<button type="button" className="outlineButton" onClick={exportCsv}><Download size={16} /> Export CSV</button>} />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Name, email, phone or city" /></div>
      <Chips value={role} onChange={(v) => { setRole(v); setPage(0); }} options={[{ value: "all", label: "Everyone" }, { value: "client", label: "Clients" }, { value: "artist", label: "Artists" }, { value: "admin", label: "Admins" }]} />
      <Chips value={state} onChange={(v) => { setState(v); setPage(0); }} options={[{ value: "all", label: "Any status" }, { value: "suspended", label: "Suspended" }, { value: "deactivated", label: "Deactivated" }, { value: "reported", label: "Has reports" }]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(u) => u.user_id} loading={loading} error={error} onRowClick={(u) => openUser(u.user_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No one matches", text: "Try a different search or clear a filter." }} />
    </>
  );
}
