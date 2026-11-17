import { useEffect, useState } from "react";
import { AlertTriangle, Camera, Check, Clock, Loader2, RefreshCw, X } from "lucide-react";
import { Avatar, Chips, DataTable, ErrorNote, Modal, PageHead, StatusTag, Tag } from "../components/ui";
import type { Column } from "../components/ui";
import { callFunction, pageQuery, PAGE_SIZE } from "../lib/db";
import { sb } from "../lib/supabase";
import { errorMessage, useAsync } from "../lib/useAsync";
import { formatDate, formatDateTime, hoursUntil, label, timeLeft } from "../lib/format";
import { useOverlay } from "../lib/overlay";
import { useToast } from "../lib/Toast";

type V = {
  id: string; user_id: string; status: string; doc_type: "sa_id" | "passport"; reason_code: string | null; review_deadline: string | null;
  decided_at: string | null; created_at: string; method: string | null; has_photo: boolean; full_name: string | null; email: string | null;
  business_name: string | null; review_detail: { scores?: { flags?: string[]; ocr_confidence?: number; name_mean?: number; name_min?: number } } | null;
};

const FLAGS: Record<string, string> = {
  low_ocr_confidence: "The photo text was hard to read",
  id_format_invalid: "The ID number's format or check digit looks wrong",
  dob_mismatch: "The date of birth doesn't match the document",
  id_number_mismatch: "The typed ID number wasn't found on the photo",
  mrz_missing: "The passport's machine-readable lines weren't found",
  mrz_checksum_failed: "The passport's checksums failed",
  passport_expired: "The passport has expired",
  name_mismatch: "The typed name doesn't match the document",
  under_18: "The date of birth makes them under 18",
  blocked_fingerprint: "This document is on the blocked list",
  duplicate_document: "This document is already used on another account",
};

const flagsOf = (v: V) => v.review_detail?.scores?.flags ?? (v.reason_code ? [v.reason_code] : []);

export default function Verifications() {
  const { openUser } = useOverlay();
  const [filter, setFilter] = useState("needs_review");
  const [page, setPage] = useState(0);
  const [active, setActive] = useState<V | null>(null);

  const { data, loading, error, reload } = useAsync(() => pageQuery<V>("admin_verifications", {
    page,
    order: filter === "needs_review" ? [{ col: "review_deadline", asc: true }] : [{ col: "created_at" }],
    apply: (q: any) => (filter === "all" ? q : q.eq("status", filter)), // eslint-disable-line @typescript-eslint/no-explicit-any
  }), [page, filter]);

  const cols: Column<V>[] = [
    { key: "who", header: "Artist", render: (v) => (
      <div className="cellPerson"><Avatar name={v.business_name ?? v.full_name} /><div><div className="cellMain clip">{v.business_name || v.full_name}</div><div className="cellSub clip">{v.email}</div></div></div>
    ) },
    { key: "doc", header: "Document", render: (v) => (v.doc_type === "sa_id" ? "South African ID" : "Passport") },
    { key: "st", header: "Status", render: (v) => <StatusTag status={v.status} /> },
    { key: "why", header: "Why a person is needed", render: (v) => {
      const f = flagsOf(v);
      return f.length ? <span className="clip" style={{ display: "block", maxWidth: 300 }}>{FLAGS[f[0]] ?? label(f[0])}{f.length > 1 ? ` (+${f.length - 1})` : ""}</span> : "-";
    } },
    { key: "when", header: filter === "needs_review" ? "Photo deleted in" : "Submitted", render: (v) => {
      if (v.status === "needs_review") {
        const h = hoursUntil(v.review_deadline);
        return <Tag tone={h !== null && h < 12 ? "red" : "amber"}><Clock size={13} /> {timeLeft(v.review_deadline)}</Tag>;
      }
      return <span className="nowrap">{formatDate(v.decided_at ?? v.created_at)}</span>;
    } },
  ];

  return (
    <>
      <PageHead title="ID checks" subtitle="Checks the automatic system couldn't settle. Photos are deleted when you decide, and automatically when the time runs out." />
      <div className="formMessage warn" style={{ marginBottom: 16 }}>
        These documents are personal information. Open a photo only to decide a check, and don't copy, screenshot or share it. Every view is recorded under your name.
      </div>
      <Chips value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[
        { value: "needs_review", label: "Needs review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" },
        { value: "resubmit", label: "New photo asked" }, { value: "expired", label: "Expired" }, { value: "all", label: "Everything" },
      ]} />
      <DataTable columns={cols} rows={data?.rows} rowKey={(v) => v.id} loading={loading} error={error}
        onRowClick={(v) => setActive(v)} page={page} size={PAGE_SIZE} total={data?.total} onPage={setPage}
        empty={{ title: filter === "needs_review" ? "Nothing waiting" : "Nothing here", text: filter === "needs_review" ? "Every ID check has been settled." : undefined }} />
      {active && <ReviewModal v={active} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} onOpenUser={() => openUser(active.user_id)} />}
    </>
  );
}

type Viewed = { url: string; expires_in: number; doc_type: string; typed: { full_name: string | null; dob: string | null; id_number: string | null }; review_detail: V["review_detail"] };

function ReviewModal({ v, onClose, onDone, onOpenUser }: { v: V; onClose: () => void; onDone: () => void; onOpenUser: () => void }) {
  const { toast } = useToast();
  const reviewable = v.status === "needs_review";
  const [viewed, setViewed] = useState<Viewed | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(false);
  const [override, setOverride] = useState(false);

  const events = useAsync(async () => {
    const { data } = await sb().from("admin_verification_events").select("event, created_at, actor_name, detail").eq("request_id", v.id).order("created_at");
    return (data ?? []) as { event: string; created_at: string; actor_name: string | null; detail: Record<string, unknown> }[];
  }, [v.id]);

  // The photo link only lives 60 seconds. When it ends we hide the image again.
  useEffect(() => {
    if (!viewed) return;
    setLeft(viewed.expires_in);
    const id = setInterval(() => setLeft((s) => {
      if (s <= 1) { clearInterval(id); setViewed((cur) => (cur ? { ...cur, url: "" } : cur)); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [viewed?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open() {
    setBusy("view"); setError(null);
    try { setViewed(await callFunction<Viewed>("admin-id-review", { action: "view", request_id: v.id })); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  }

  async function decide(decision: "approve" | "reject" | "resubmit") {
    setBusy(decision); setError(null);
    try {
      await callFunction("admin-id-review", { action: "decide", request_id: v.id, decision, note, block, override });
      toast(decision === "approve" ? "Approved. The artist is now ID checked and visible." : decision === "reject" ? "Rejected. The photo has been deleted." : "Asked for a new photo. The photo has been deleted.");
      onDone();
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  }

  const flags = flagsOf(v);
  const detail = viewed?.review_detail ?? v.review_detail;
  const dup = flags.includes("duplicate_document");
  const typed = viewed?.typed;

  return (
    <Modal open wide title={v.business_name || v.full_name || "ID check"} onClose={onClose}>
      <div className="rowActions" style={{ marginBottom: 16, alignItems: "center" }}>
        <StatusTag status={v.status} />
        <Tag>{v.doc_type === "sa_id" ? "South African ID" : "Passport"}</Tag>
        {v.method && <Tag>Decided: {v.method}</Tag>}
        <button type="button" className="textButton" onClick={onOpenUser}>Open artist profile</button>
      </div>

      {flags.length > 0 && (
        <div className="section" style={{ marginBottom: 16 }}>
          <h3>Why this needs a person</h3>
          <ul className="flagList">{flags.map((f) => <li key={f}><AlertTriangle size={16} />{FLAGS[f] ?? label(f)}</li>)}</ul>
          {detail?.scores && <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Text confidence {detail.scores.ocr_confidence ?? "-"} · name match {detail.scores.name_mean ?? "-"} (lowest word {detail.scores.name_min ?? "-"})</p>}
        </div>
      )}

      {reviewable && (
        <div className="compare">
          <div>
            <div className="idFrame" onContextMenu={(e) => e.preventDefault()}>
              {viewed?.url ? (<><img src={viewed.url} alt="The uploaded document" draggable={false} /><span className="timer">{left}s left</span></>) : (
                <div style={{ color: "#bbb", textAlign: "center", padding: 24 }}>
                  <Camera size={28} style={{ marginBottom: 8 }} />
                  <div style={{ marginBottom: 12 }}>{viewed ? "The 60 seconds are up." : "The photo stays hidden until you open it."}</div>
                  <button type="button" className="primaryButton smallButton" onClick={open} disabled={busy === "view"}>
                    {busy === "view" ? <Loader2 size={15} className="spin" /> : viewed ? <RefreshCw size={15} /> : <Camera size={15} />} {viewed ? "Open again" : "Open photo"}
                  </button>
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>The link works for 60 seconds. Opening it is logged.</p>
          </div>
          <div className="section">
            <h3>What the artist typed</h3>
            {typed ? (
              <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                <dt>Full name</dt><dd>{typed.full_name}</dd>
                <dt>Date of birth</dt><dd>{formatDate(typed.dob)}</dd>
                <dt>{v.doc_type === "sa_id" ? "ID number" : "Passport no."}</dt><dd className="mono">{typed.id_number}</dd>
              </dl>
            ) : <span className="muted">Shown when you open the photo, so you can compare the two side by side.</span>}
            <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Check the name, date of birth and number match the document, that it isn't expired, and that it looks genuine. This is not a Home Affairs or face check.</p>
          </div>
        </div>
      )}

      {reviewable && (
        <div style={{ marginTop: 18 }}>
          <label className="formField">
            <span>Note (saved in the audit log)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Don't write ID numbers or names here." style={{ minHeight: 64 }} />
          </label>
          {dup && <label className="checkRow"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />Approve anyway, even though this document is linked to another account.</label>}
          <label className="checkRow"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />If rejecting: also block this document so it can't be used on any account.</label>
          {error && <ErrorNote message={error} />}
          <div className="modalActions" style={{ justifyContent: "space-between" }}>
            <button type="button" className="outlineButton" onClick={() => decide("resubmit")} disabled={!!busy}>{busy === "resubmit" && <Loader2 size={15} className="spin" />} Ask for a new photo</button>
            <span className="rowActions">
              <button type="button" className="outlineButton dangerButton" onClick={() => decide("reject")} disabled={!!busy || note.trim().length < 5} title={note.trim().length < 5 ? "Add a note first" : ""}><X size={16} /> Reject</button>
              <button type="button" className="primaryButton" onClick={() => decide("approve")} disabled={!!busy || !viewed}><Check size={16} /> Approve</button>
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, textAlign: "right" }}>Approving needs you to have opened the photo. Rejecting needs a note. The photo is deleted when you decide.</p>
        </div>
      )}
      {!reviewable && error && <ErrorNote message={error} />}

      <div className="section" style={{ marginTop: 18 }}>
        <h3>History</h3>
        {events.data && events.data.length > 0 ? (
          <div className="miniList">
            {events.data.map((e, i) => (
              <div key={i} className="miniRow"><span>{label(e.event)}{e.actor_name ? ` · ${e.actor_name}` : ""}</span><span className="muted">{formatDateTime(e.created_at)}</span></div>
            ))}
          </div>
        ) : <span className="muted">No history yet.</span>}
      </div>
    </Modal>
  );
}
