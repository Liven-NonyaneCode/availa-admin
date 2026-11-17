import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { ConfirmModal, ErrorNote, Field, Loading, PageHead, StatusTag } from "../components/ui";
import { sb } from "../lib/supabase";
import { errorMessage, useAsync } from "../lib/useAsync";
import { formatDate } from "../lib/format";
import { useToast } from "../lib/Toast";

type Spec = { key: string; label: string; hint: string; min: number; max: number; step?: number; fallback: string };

const MONEY: Spec[] = [
  { key: "deposit_percent", label: "Booking deposit (%)", hint: "Share of the price the client pays upfront to secure the slot. Card only and non-refundable, unless the artist cancels.", min: 0, max: 100, fallback: "30" },
  { key: "hold_minutes", label: "Slot hold (minutes)", hint: "How long a slot is held while the client pays before it is released.", min: 1, max: 120, fallback: "15" },
  { key: "platform_fee_percent", label: "Availa fee (%)", hint: "Taken from card payments before the artist is paid. Applies to new payments only.", min: 0, max: 50, fallback: "10" },
  { key: "min_payout", label: "Smallest payout (R)", hint: "Artists can't withdraw less than this.", min: 0, max: 100000, fallback: "100" },
  { key: "payout_account_cooldown_hours", label: "Wait after bank details change (hours)", hint: "Withdrawals stay locked this long after an artist changes their bank account. Protects against account takeover. 0 turns it off.", min: 0, max: 168, fallback: "0" },
];
const IDV: Spec[] = [
  { key: "review_hold_hours", label: "How long a person has to review (hours)", hint: "The photo is deleted automatically after this, and the check expires.", min: 1, max: 168, fallback: "72" },
  { key: "stale_upload_hours", label: "Delete unsubmitted uploads after (hours)", hint: "For photos uploaded but never submitted.", min: 1, max: 168, fallback: "24" },
  { key: "attempts_per_day", label: "Attempts per artist per day", hint: "Limits repeated tries.", min: 1, max: 50, fallback: "5" },
  { key: "min_image_long_side", label: "Smallest photo size (pixels, long side)", hint: "Smaller photos are sent back for a better one.", min: 200, max: 4000, fallback: "800" },
  { key: "ocr_min_confidence", label: "Smallest text confidence (0 to 1)", hint: "Below this, a person has to look. Higher means more reviews.", min: 0, max: 1, step: 0.01, fallback: "0.8" },
  { key: "name_mean_min", label: "Name match, average (0 to 1)", hint: "How closely the typed name must match on average.", min: 0, max: 1, step: 0.01, fallback: "0.88" },
  { key: "name_each_min", label: "Name match, weakest word (0 to 1)", hint: "How closely every single word must match.", min: 0, max: 1, step: 0.01, fallback: "0.8" },
];

export default function Settings() {
  const app = useAsync(async () => {
    const { data, error } = await sb().from("app_settings").select("key, value");
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.key as string, String(r.value)]));
  }, []);
  const idv = useAsync(async () => {
    const { data, error } = await sb().from("verification_settings").select("key, value");
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.key as string, String(r.value)]));
  }, []);
  const admins = useAsync(async () => {
    const { data } = await sb().from("admin_users").select("user_id, full_name, email, created_at, last_sign_in_at, is_suspended").eq("role", "admin");
    return (data ?? []) as { user_id: string; full_name: string | null; email: string; created_at: string; is_suspended: boolean }[];
  }, []);

  return (
    <>
      <PageHead title="Settings" subtitle="Platform rules. Changes apply to the whole app straight away and are recorded in the audit log." />
      {(app.error || idv.error) && <ErrorNote message={app.error ?? idv.error ?? ""} />}
      {(app.loading || idv.loading) && !app.data && <Loading />}
      {app.data && <PaymentMode current={app.data.payment_mode ?? "off"} currency={app.data.currency ?? "ZAR"} onSaved={app.reload} />}
      <div className="stack" style={{ marginTop: 20 }}>
        {app.data && <NumberGroup title="Payments and payouts" table="app_settings" specs={MONEY} values={app.data} onSaved={app.reload} />}
        {idv.data && <NumberGroup title="ID check rules" table="verification_settings" specs={IDV} values={idv.data} onSaved={idv.reload} />}
        <div className="card cardPad">
          <div className="cardHead"><div><h2>Admin team</h2><p>Admins are added and removed in the database on purpose, so nobody can promote themselves.</p></div></div>
          <div className="miniList">
            {(admins.data ?? []).map((a) => (
              <div key={a.user_id} className="miniRow"><div><div className="cellMain">{a.full_name || a.email}</div><div className="cellSub">{a.email} · since {formatDate(a.created_at)}</div></div>{a.is_suspended ? <StatusTag status="suspended" /> : <StatusTag status="active" />}</div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 14, lineHeight: 1.55 }}>To add one, run <code>update public.profiles set role = 'admin' where email = '…';</code> in the Supabase SQL Editor. See the README.</p>
        </div>
      </div>
    </>
  );
}

function PaymentMode({ current, currency, onSaved }: { current: string; currency: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState(current);
  const [ask, setAsk] = useState(false);
  useEffect(() => setMode(current), [current]);
  const risky = mode !== current;

  return (
    <div className="card cardPad">
      <div className="cardHead"><div><h2>Payment mode</h2><p>Currency is {currency}. It is fixed in the payment code, so it can't be changed here.</p></div></div>
      <Field label="Mode" hint={mode === "paystack" ? "Real card payments through Paystack." : mode === "dummy" ? "A fake checkout for testing. No real money moves." : "Payments are switched off. Bookings are confirmed without a deposit."}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="off">Off: no payments</option><option value="dummy">Test checkout (no real money)</option><option value="paystack">Paystack (real payments)</option>
        </select>
      </Field>
      {risky && <div className="formMessage warn"><ShieldAlert size={15} style={{ verticalAlign: -3 }} /> {mode === "paystack" ? "This starts taking real money. Make sure the Paystack account is verified and its LIVE secret key is set on the server." : "Bookings already in progress keep the payments they have. New bookings follow the new mode."}</div>}
      <button type="button" className="primaryButton" disabled={!risky} onClick={() => setAsk(true)}>Change payment mode</button>
      <ConfirmModal open={ask} danger={mode === "paystack"} title="Change the payment mode?" confirmLabel="Change mode" minReason={5} onClose={() => setAsk(false)}
        message={`From “${current}” to “${mode}”. This affects every new booking straight away.`}
        onConfirm={async () => { const { error } = await sb().from("app_settings").upsert({ key: "payment_mode", value: mode }, { onConflict: "key" }); if (error) throw error; toast("Payment mode changed."); onSaved(); }} />
    </div>
  );
}

function NumberGroup({ title, table, specs, values, onSaved }: { title: string; table: "app_settings" | "verification_settings"; specs: Spec[]; values: Record<string, string>; onSaved: () => void }) {
  const { toast } = useToast();
  const init = () => Object.fromEntries(specs.map((s) => [s.key, values[s.key] ?? s.fallback]));
  const [f, setF] = useState<Record<string, string>>(init);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => setF(init()), [values]); // eslint-disable-line react-hooks/exhaustive-deps

  const bad = specs.find((s) => { const n = Number(f[s.key]); return f[s.key].trim() === "" || !Number.isFinite(n) || n < s.min || n > s.max; });
  const changed = specs.filter((s) => f[s.key] !== (values[s.key] ?? s.fallback));

  async function save() {
    setBusy(true); setErr(null);
    try {
      const { error } = await sb().from(table).upsert(changed.map((s) => ({ key: s.key, value: f[s.key].trim() })), { onConflict: "key" });
      if (error) throw error;
      toast(`${title} saved.`); onSaved();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card cardPad">
      <div className="cardHead"><h2>{title}</h2></div>
      <div className="formRow">
        {specs.map((s) => (
          <Field key={s.key} label={s.label} hint={`${s.hint} (${s.min} to ${s.max})`}>
            <input type="number" min={s.min} max={s.max} step={s.step ?? 1} value={f[s.key]} onChange={(e) => setF({ ...f, [s.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      {bad && <div className="formMessage error">“{bad.label}” must be a number from {bad.min} to {bad.max}.</div>}
      {err && <ErrorNote message={err} />}
      <button type="button" className="primaryButton" disabled={busy || !!bad || changed.length === 0} onClick={save}>{busy && <Loader2 size={15} className="spin" />} Save {changed.length > 0 ? `${changed.length} change${changed.length > 1 ? "s" : ""}` : "changes"}</button>
    </div>
  );
}
