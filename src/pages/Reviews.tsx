import { useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Chips, ConfirmModal, DataTable, PageHead, SearchBox, Stars, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { logAction, pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { useAsync, useDebounced } from "../lib/useAsync";
import { formatDate } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";

type R = { review_id: string; booking_id: string; artist_id: string; rating: number; review_text: string; is_visible: boolean; created_at: string; client_name: string | null; artist_name: string | null; service_name: string | null };

export default function Reviews() {
  const { toast } = useToast();
  const { openUser } = useOverlay();
  const [q, setQ] = useState(""); const [filter, setFilter] = useState("all"); const [page, setPage] = useState(0);
  const [act, setAct] = useState<{ r: R; kind: "hide" | "show" | "delete" } | null>(null);
  const term = useDebounced(q);

  const { data, loading, error, reload } = useAsync(() => pageQuery<R>("admin_reviews", {
    page, order: [{ col: "created_at" }], search: { cols: ["review_text", "client_name", "artist_name"], term },
    apply: (query: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (filter === "hidden") query = query.eq("is_visible", false);
      if (filter === "visible") query = query.eq("is_visible", true);
      if (filter === "low") query = query.lte("rating", 2);
      return query;
    },
  }), [page, term, filter]);

  async function run(reason: string) {
    if (!act) return;
    const client = sb();
    if (act.kind === "delete") {
      const { error: e } = await client.from("reviews").delete().eq("review_id", act.r.review_id);
      if (e) throw e;
      await logAction("delete_review", "reviews", act.r.review_id, "Deleted a review", { reason, artist_id: act.r.artist_id, rating: act.r.rating });
    } else {
      const { error: e } = await client.from("reviews").update({ is_visible: act.kind === "show" }).eq("review_id", act.r.review_id);
      if (e) throw e;
      await logAction(`${act.kind}_review`, "reviews", act.r.review_id, act.kind === "hide" ? "Hid a review" : "Showed a review", { reason });
    }
    toast(act.kind === "delete" ? "Review deleted." : act.kind === "hide" ? "Review hidden. The artist's rating was recalculated." : "Review visible again.");
    reload();
  }

  const cols: Column<R>[] = [
    { key: "r", header: "Rating", render: (r) => <Stars value={r.rating} /> },
    { key: "t", header: "Review", render: (r) => <div style={{ maxWidth: 420 }}><div className="clip" style={{ maxWidth: 420 }}>{r.review_text || <span className="muted">No text</span>}</div><div className="cellSub">{r.service_name ?? ""}</div></div> },
    { key: "c", header: "From", render: (r) => <span className="clip">{r.client_name ?? "-"}</span> },
    { key: "a", header: "About", render: (r) => <button type="button" className="textButton" onClick={() => openUser(r.artist_id)}>{r.artist_name ?? "-"}</button> },
    { key: "d", header: "Date", render: (r) => <span className="nowrap">{formatDate(r.created_at)}</span> },
    { key: "v", header: "Shown", render: (r) => r.is_visible ? <Tag tone="green">Visible</Tag> : <Tag tone="red">Hidden</Tag> },
    { key: "x", header: "", render: (r) => (
      <span className="rowActions">
        <button type="button" className="outlineButton smallButton" onClick={() => setAct({ r, kind: r.is_visible ? "hide" : "show" })}>{r.is_visible ? <><EyeOff size={14} /> Hide</> : <><Eye size={14} /> Show</>}</button>
        <button type="button" className="outlineButton dangerButton smallButton" onClick={() => setAct({ r, kind: "delete" })} aria-label="Delete review"><Trash2 size={14} /></button>
      </span>
    ) },
  ];

  return (
    <>
      <PageHead title="Reviews" subtitle="Hiding a review removes it from the artist's profile and rating without deleting it. Deleting is permanent." />
      <div className="toolbar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder="Review text, client or artist" /></div>
      <Chips value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[{ value: "all", label: "All" }, { value: "low", label: "1 to 2 stars" }, { value: "hidden", label: "Hidden" }, { value: "visible", label: "Visible" }]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(r) => r.review_id} loading={loading} error={error} page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage} empty={{ title: "No reviews match" }} />
      <ConfirmModal open={!!act} danger={act?.kind !== "show"} title={act?.kind === "delete" ? "Delete this review?" : act?.kind === "hide" ? "Hide this review?" : "Show this review again?"}
        confirmLabel={act?.kind === "delete" ? "Delete forever" : act?.kind === "hide" ? "Hide review" : "Show review"} minReason={5} onConfirm={run} onClose={() => setAct(null)}
        message={act?.kind === "delete" ? "This can't be undone. The client can leave a new review after their next completed booking." : undefined} />
    </>
  );
}
