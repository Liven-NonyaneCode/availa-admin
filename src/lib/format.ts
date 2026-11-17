export type Tone = "green" | "amber" | "blue" | "purple" | "red" | "grey";

/** "R1,250.00", the same format as the Availa app. */
export function formatMoney(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  const [whole, cents] = Math.abs(Number.isFinite(n) ? n : 0).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}R${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export const formatNumber = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString("en-ZA");

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
}

/** "14:30:00" -> "14:30" */
export const formatTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "-");

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(iso);
}

/** Hours left until a deadline (negative once passed). */
export const hoursUntil = (iso: string | null | undefined) =>
  iso ? (new Date(iso).getTime() - Date.now()) / 3600000 : null;

export function timeLeft(iso: string | null | undefined): string {
  const h = hoursUntil(iso);
  if (h === null) return "-";
  if (h <= 0) return "overdue";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min left`;
  if (h < 48) return `${Math.round(h)} h left`;
  return `${Math.round(h / 24)} d left`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "awaiting_payment" -> "Awaiting payment" */
export function label(value: string | null | undefined): string {
  const s = (value ?? "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "-";
}

const TONES: Record<string, Tone> = {
  // bookings
  awaiting_payment: "amber", pending: "amber", confirmed: "blue", in_progress: "purple", completed: "green",
  cancelled: "red", declined: "red", no_show: "red", expired: "grey",
  // payments, refunds, payouts
  success: "green", failed: "red", refunded: "grey", processing: "amber", reversed: "red",
  due: "amber", done: "green", sent: "green", succeeded: "green", partial: "amber",
  // earnings
  held: "amber", available: "green", in_payout: "purple", paid_out: "grey", refund_due: "red",
  // verification
  approved: "green", rejected: "red", needs_review: "amber", resubmit: "amber", withdrawn: "grey",
  awaiting_upload: "grey", verified: "green", unverified: "grey",
  // reports & support
  open: "red", investigating: "amber", actioned: "green", dismissed: "grey",
  // accounts
  active: "green", suspended: "red", deactivated: "grey", admin: "purple", artist: "blue", client: "green",
};
export const toneFor = (status: string | null | undefined): Tone => TONES[String(status ?? "")] ?? "grey";

/** A tidy sentence for the plain reasons a refund or booking can be stuck. */
export const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
