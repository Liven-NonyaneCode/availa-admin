import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Avatar, Chips, DataTable, PageHead, SearchBox, Stars, StatusTag, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { pageQuery, PAGE_SIZE } from "../lib/db";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDate } from "../lib/format";
import { useOverlay } from "../lib/overlay";

type A = {
  user_id: string; full_name: string | null; email: string; avatar_url: string | null; city: string | null; business_name: string | null;
  verification_status: string | null; is_listed: boolean | null; is_available: boolean | null; average_rating: number; review_count: number;
  booking_count: number; is_suspended: boolean; created_at: string;
};

export default function Artists() {
  const { openUser } = useOverlay();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const term = useDebounced(q);

  const { data, loading, error } = useAsync(() => pageQuery<A>("admin_users", {
    page, order: [{ col: "created_at" }], search: { cols: ["business_name", "full_name", "email", "city"], term },
    apply: (query: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      query = query.eq("role", "artist");
      if (filter === "listed") query = query.eq("is_listed", true);
      if (filter === "hidden") query = query.neq("is_listed", true);
      if (["unverified", "pending", "verified", "rejected"].includes(filter)) query = query.eq("verification_status", filter);
      return query;
    },
  }), [page, term, filter]);

  const cols: Column<A>[] = [
    { key: "who", header: "Artist", render: (a) => (
      <div className="cellPerson"><Avatar name={a.business_name ?? a.full_name} url={a.avatar_url} /><div><div className="cellMain clip">{a.business_name || a.full_name}</div><div className="cellSub clip">{a.full_name} · {a.email}</div></div></div>
    ) },
    { key: "city", header: "City", render: (a) => a.city || "-" },
    { key: "id", header: "ID check", render: (a) => <StatusTag status={a.verification_status} /> },
    { key: "vis", header: "On Find Artists", render: (a) => a.is_listed ? <Tag tone="green"><Eye size={13} /> Visible</Tag> : <Tag><EyeOff size={13} /> Hidden</Tag> },
    { key: "rt", header: "Rating", render: (a) => <span className="nowrap"><Stars value={Number(a.average_rating)} /> <span className="muted">({a.review_count})</span></span> },
    { key: "bk", header: "Bookings", align: "right", render: (a) => <span className="mono">{a.booking_count}</span> },
    { key: "j", header: "Joined", render: (a) => <span className="nowrap">{formatDate(a.created_at)}</span> },
    { key: "s", header: "", render: (a) => a.is_suspended ? <StatusTag status="suspended" /> : null },
  ];

  return (
    <>
      <PageHead title="Artists" subtitle="Who is on Find Artists, who has passed an ID check, and how they're doing." />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Business, name, email or city" /></div>
      <Chips value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
        { value: "all", label: "All artists" }, { value: "listed", label: "Visible" }, { value: "hidden", label: "Hidden" },
        { value: "unverified", label: "No ID check" }, { value: "pending", label: "ID in review" }, { value: "verified", label: "ID checked" }, { value: "rejected", label: "ID rejected" },
      ]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(a) => a.user_id} loading={loading} error={error} onRowClick={(a) => openUser(a.user_id)}
        page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No artists match" }} />
    </>
  );
}
