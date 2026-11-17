import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, KeyRound, Mail, Pencil, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { Avatar, ConfirmModal, Drawer, Empty, ErrorNote, Field, Loading, Modal, Stars, StatusTag, Tag, Toggle } from "./ui";
import { useAsync } from "../lib/useAsync";
import { callFunction, logAction } from "../lib/db";
import { sb } from "../lib/supabase";
import { formatDate, formatDateTime, formatMoney, formatTime, label, timeAgo } from "../lib/format";
import { useToast } from "../lib/Toast";
import { useOverlay } from "../lib/overlay";
import { errorMessage } from "../lib/useAsync";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A lookup that is allowed to fail without stopping the panel from opening. */
async function soft<T>(p: PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  try {
    const { data, error } = await p;
    return error || data === null ? fallback : data;
  } catch {
    return fallback;
  }
}

export default function UserDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { openBooking } = useOverlay();
  const [confirm, setConfirm] = useState<null | "suspend" | "unsuspend" | "reset" | "list" | "unlist">(null);
  const [editing, setEditing] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const client = sb();
    const { data: user, error: userError } = await client.from("admin_users").select("*").eq("user_id", userId).maybeSingle();
    if (userError) throw userError;
    if (!user) return null;

    const [bookings, reports] = await Promise.all([
      soft<Row[]>(client.from("admin_bookings").select("booking_id, booking_date, start_time, status, price, service_name, client_name, artist_name, client_id")
        .or(`client_id.eq.${userId},artist_id.eq.${userId}`).order("booking_date", { ascending: false }).limit(8), []),
      soft<Row[]>(client.from("admin_reports").select("ref_id, reason, status, created_at, reporter_name").eq("reported_id", userId)
        .order("created_at", { ascending: false }).limit(5), []),
    ]);

    let artist: Row | null = null;
    let earnings: Row | null = null;
    let services: Row[] = [];
    if (user.role === "artist") {
      [artist, earnings, services] = await Promise.all([
        soft<Row | null>(client.from("artist_profiles").select("*").eq("user_id", userId).maybeSingle(), null),
        soft<Row | null>(client.from("admin_artist_earnings").select("*").eq("artist_id", userId).maybeSingle(), null),
        soft<Row[]>(client.from("artist_services").select("price, duration_minutes, is_available, services(service_name)").eq("artist_id", userId), []),
      ]);
    }
    return { user: user as Row, bookings, reports, artist, earnings, services };
  }, [userId]);

  const u = data?.user;
  const isArtist = u?.role === "artist";

  async function suspend(reason: string) {
    await callFunction("admin-user", { action: "suspend", user_id: userId, reason });
    toast("Account suspended.");
    reload();
  }
  async function unsuspend() {
    await callFunction("admin-user", { action: "unsuspend", user_id: userId });
    toast("Account reinstated.");
    reload();
  }
  async function sendReset() {
    await callFunction("admin-user", { action: "send_reset", user_id: userId });
    toast("Password reset email sent.");
  }
  async function setListed(value: boolean) {
    const { error: e } = await sb().from("artist_profiles").update({ is_listed: value }).eq("user_id", userId);
    if (e) throw e;
    toast(value ? "Artist is now visible to clients." : "Artist is hidden from clients.");
    reload();
  }
  async function setAvailable(value: boolean) {
    const { error: e } = await sb().from("artist_profiles").update({ is_available: value }).eq("user_id", userId);
    if (e) toast(errorMessage(e), "error");
    else reload();
  }
  async function removePhoto(url: string, reason: string) {
    const next = ((data?.artist?.gallery as string[]) ?? []).filter((g) => g !== url);
    const { error: e } = await sb().from("artist_profiles").update({ gallery: next }).eq("user_id", userId);
    if (e) throw e;
    await logAction("remove_gallery_photo", "artist_profiles", userId, "Removed a gallery photo", { reason, url });
    toast("Photo removed from the profile.");
    reload();
  }
  const [photoToRemove, setPhotoToRemove] = useState<string | null>(null);

  return (
    <Drawer open title={u ? (isArtist ? u.business_name || u.full_name : u.full_name) || "Account" : "Account"} onClose={onClose}>
      {loading && !data && <Loading />}
      {error && <ErrorNote message={error} />}
      {!loading && !error && !u && <Empty title="Account not found" text="It may have been removed." />}

      {u && (
        <>
          <section className="section">
            <div className="profileHero">
              <Avatar name={u.full_name} url={u.avatar_url} size="lg" />
              <div style={{ minWidth: 0 }}>
                <h2>{u.full_name || "Unnamed"}</h2>
                <div className="rowActions" style={{ marginTop: 8 }}>
                  <StatusTag status={u.role} />
                  {u.is_suspended && <StatusTag status="suspended" />}
                  {u.is_deactivated && <StatusTag status="deactivated" />}
                  {isArtist && <StatusTag status={u.verification_status} text={`ID: ${label(u.verification_status)}`} />}
                </div>
              </div>
            </div>
            <dl className="kv" style={{ marginTop: 18 }}>
              <dt>Email</dt><dd>{u.email || "-"}</dd>
              <dt>Phone</dt><dd>{u.phone || "-"}</dd>
              <dt>City</dt><dd>{u.city || "-"}</dd>
              <dt>Joined</dt><dd>{formatDate(u.created_at)}</dd>
              <dt>Last signed in</dt><dd>{u.last_sign_in_at ? `${timeAgo(u.last_sign_in_at)} (${formatDateTime(u.last_sign_in_at)})` : "Never"}</dd>
              <dt>Bookings</dt><dd>{u.booking_count}</dd>
              <dt>Reports against</dt><dd>{u.reports_against}</dd>
              {u.is_suspended && (<><dt>Suspended</dt><dd>{formatDate(u.suspended_at)}: {u.suspended_reason}</dd></>)}
            </dl>
            <div className="rowActions" style={{ marginTop: 18 }}>
              <button type="button" className="outlineButton smallButton" onClick={() => setEditing(true)}><Pencil size={15} /> Edit details</button>
              <button type="button" className="outlineButton smallButton" onClick={() => setConfirm("reset")} disabled={!u.email}><KeyRound size={15} /> Send password reset</button>
              {u.email && <a className="outlineButton smallButton" href={`mailto:${u.email}`}><Mail size={15} /> Email</a>}
              {u.role !== "admin" && (u.is_suspended
                ? <button type="button" className="primaryButton smallButton" onClick={() => setConfirm("unsuspend")}><UserCheck size={15} /> Reinstate</button>
                : <button type="button" className="outlineButton dangerButton smallButton" onClick={() => setConfirm("suspend")}><Ban size={15} /> Suspend</button>)}
            </div>
          </section>

          {isArtist && data?.artist && (
            <section className="section">
              <h3>Artist profile</h3>
              <dl className="kv">
                <dt>Business</dt><dd>{data.artist.business_name}</dd>
                <dt>Location</dt><dd>{data.artist.location || "-"}</dd>
                <dt>Rating</dt><dd><Stars value={Number(data.artist.average_rating)} /> <span className="muted">({data.artist.review_count} reviews)</span></dd>
                <dt>Experience</dt><dd>{data.artist.years_experience} years</dd>
                <dt>Instagram</dt><dd>{data.artist.instagram_handle || "-"}</dd>
                <dt>Bio</dt><dd>{data.artist.bio || "-"}</dd>
              </dl>
              <div className="miniList" style={{ marginTop: 14 }}>
                <div className="miniRow">
                  <div><div className="cellMain">Visible to clients</div><div className="cellSub">{data.artist.verification_status === "verified" ? "ID checked" : "ID not checked yet"}</div></div>
                  <Toggle label="Visible to clients" on={!!data.artist.is_listed} onChange={(v) => setConfirm(v ? "list" : "unlist")} />
                </div>
                <div className="miniRow">
                  <div><div className="cellMain">Accepting bookings</div><div className="cellSub">The artist's own online switch</div></div>
                  <Toggle label="Accepting bookings" on={!!data.artist.is_available} onChange={setAvailable} />
                </div>
              </div>
              {Array.isArray(data.artist.gallery) && data.artist.gallery.length > 0 && (
                <>
                  <div className="cellMain" style={{ margin: "16px 0 10px" }}>Gallery ({data.artist.gallery.length})</div>
                  <div className="galleryGrid">
                    {(data.artist.gallery as string[]).map((url) => (
                      <div key={url} className="galleryThumb">
                        <img src={url} alt="" loading="lazy" />
                        <button type="button" className="galleryRemove" onClick={() => setPhotoToRemove(url)} aria-label="Remove photo"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {data.services.length > 0 && (
                <>
                  <div className="cellMain" style={{ margin: "16px 0 6px" }}>Services</div>
                  <div className="miniList">
                    {data.services.map((s, i) => (
                      <div key={i} className="miniRow">
                        <span>{s.services?.service_name ?? "Service"} {!s.is_available && <Tag>Off</Tag>}</span>
                        <span className="muted mono">{formatMoney(s.price)}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {isArtist && data?.earnings && (
            <section className="section">
              <h3>Earnings</h3>
              <dl className="kv">
                <dt>Card payments</dt><dd className="mono">{formatMoney(data.earnings.gross)}</dd>
                <dt>Availa's fee</dt><dd className="mono">{formatMoney(data.earnings.platform_fee)}</dd>
                <dt>Held</dt><dd className="mono">{formatMoney(data.earnings.held)}</dd>
                <dt>Available</dt><dd className="mono">{formatMoney(data.earnings.available)}</dd>
                <dt>Paid out</dt><dd className="mono">{formatMoney(data.earnings.paid_out)}</dd>
                <dt>Refund due</dt><dd className="mono">{formatMoney(data.earnings.refund_due)}</dd>
              </dl>
            </section>
          )}

          <section className="section">
            <h3>Recent bookings <Link to={`/bookings?q=${encodeURIComponent(u.full_name ?? "")}`} onClick={onClose} className="textButton smallButton">See all</Link></h3>
            {data!.bookings.length === 0 ? <span className="muted">No bookings yet.</span> : (
              <div className="miniList">
                {data!.bookings.map((b) => (
                  <div key={b.booking_id} className="miniRow clickable" onClick={() => openBooking(b.booking_id)}>
                    <div>
                      <div className="cellMain">{b.service_name}</div>
                      <div className="cellSub">{formatDate(b.booking_date)} {formatTime(b.start_time)} · {isArtist ? b.client_name : b.artist_name}</div>
                    </div>
                    <div className="rowActions" style={{ alignItems: "center" }}><span className="mono muted">{formatMoney(b.price)}</span><StatusTag status={b.status} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section">
            <h3>Reports against this person</h3>
            {data!.reports.length === 0 ? <span className="muted">None.</span> : (
              <div className="miniList">
                {data!.reports.map((r) => (
                  <Link key={r.ref_id} to="/reports" onClick={onClose} className="miniRow">
                    <div><div className="cellMain">{r.reason}</div><div className="cellSub">From {r.reporter_name ?? "someone"} · {timeAgo(r.created_at)}</div></div>
                    <StatusTag status={r.status} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {u && <EditDetails open={editing} onClose={() => setEditing(false)} user={u} artist={data?.artist ?? null} onSaved={reload} />}

      <ConfirmModal open={confirm === "suspend"} danger title="Suspend this account?" confirmLabel="Suspend account" minReason={5} onConfirm={suspend} onClose={() => setConfirm(null)}
        message="They'll be signed out and unable to sign in. An artist disappears from Find Artists. Their bookings, payments and reviews stay exactly as they are." />
      <ConfirmModal open={confirm === "unsuspend"} title="Reinstate this account?" confirmLabel="Reinstate" onConfirm={unsuspend} onClose={() => setConfirm(null)}
        message="They can sign in again. An artist whose ID check passed goes back on Find Artists." />
      <ConfirmModal open={confirm === "reset"} title="Send a password reset email?" confirmLabel="Send email" onConfirm={sendReset} onClose={() => setConfirm(null)}
        message={`We'll email a reset link to ${u?.email ?? "this person"}.`} />
      <ConfirmModal open={confirm === "list"} title="Show this artist to clients?" confirmLabel="Make visible" minReason={5}
        onConfirm={async (reason) => { await setListed(true); await logAction("list_artist", "artist_profiles", userId, "Made an artist visible", { reason }); }} onClose={() => setConfirm(null)}
        message={data?.artist?.verification_status === "verified" ? "Clients will be able to find and book this artist." : "This artist has not passed an ID check. Only continue if you have verified them another way."} />
      <ConfirmModal open={confirm === "unlist"} danger title="Hide this artist from clients?" confirmLabel="Hide artist" minReason={5}
        onConfirm={async (reason) => { await setListed(false); await logAction("unlist_artist", "artist_profiles", userId, "Hid an artist", { reason }); }} onClose={() => setConfirm(null)}
        message="They disappear from Find Artists straight away. Existing bookings are not affected." />
      <ConfirmModal open={photoToRemove !== null} danger title="Remove this photo?" confirmLabel="Remove photo" minReason={5}
        onConfirm={async (reason) => { if (photoToRemove) await removePhoto(photoToRemove, reason); }} onClose={() => setPhotoToRemove(null)}
        message="The photo is taken off the artist's profile. The artist can upload a different one." />
    </Drawer>
  );
}

function EditDetails({ open, onClose, user, artist, onSaved }: { open: boolean; onClose: () => void; user: Row; artist: Row | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({
    full_name: user.full_name ?? "", phone: user.phone ?? "", city: user.city ?? "",
    business_name: artist?.business_name ?? "", location: artist?.location ?? "", bio: artist?.bio ?? "", instagram_handle: artist?.instagram_handle ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((c) => ({ ...c, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const client = sb();
      const a = await client.from("profiles").update({ full_name: f.full_name.trim(), phone: f.phone.trim() || null, city: f.city.trim() || null }).eq("user_id", user.user_id);
      if (a.error) throw a.error;
      if (artist) {
        const b = await client.from("artist_profiles").update({
          business_name: f.business_name.trim(), location: f.location.trim(), bio: f.bio.trim(), instagram_handle: f.instagram_handle.trim() || null,
        }).eq("user_id", user.user_id);
        if (b.error) throw b.error;
      }
      toast("Details saved.");
      onSaved();
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit details">
      <p className="muted" style={{ marginBottom: 16, lineHeight: 1.55 }}>For fixing typos and removing content that breaks the rules. Every change is recorded in the audit log.</p>
      <Field label="Full name"><input value={f.full_name} onChange={set("full_name")} /></Field>
      <div className="formRow">
        <Field label="Phone"><input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="City"><input value={f.city} onChange={set("city")} /></Field>
      </div>
      {artist && (
        <>
          <Field label="Business name"><input value={f.business_name} onChange={set("business_name")} /></Field>
          <div className="formRow">
            <Field label="Location"><input value={f.location} onChange={set("location")} /></Field>
            <Field label="Instagram"><input value={f.instagram_handle} onChange={set("instagram_handle")} /></Field>
          </div>
          <Field label="Bio"><textarea value={f.bio} onChange={set("bio")} /></Field>
        </>
      )}
      {err && <div className="formMessage error">{err}</div>}
      <div className="modalActions">
        <button type="button" className="outlineButton" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="primaryButton" onClick={save} disabled={busy || f.full_name.trim().length < 2}><ShieldCheck size={16} /> Save changes</button>
      </div>
    </Modal>
  );
}
