import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, Star, X } from "lucide-react";
import { initials, label, toneFor } from "../lib/format";
import type { Tone } from "../lib/format";
import { errorMessage } from "../lib/useAsync";

// ---------- small display pieces ----------

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="pageHead">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="pageActions">{actions}</div>}
    </div>
  );
}

export function Tag({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tone-${tone}`}>{children}</span>;
}

/** Status text with the colour the status deserves. Pass `text` to override the label. */
export function StatusTag({ status, text }: { status: string | null | undefined; text?: string }) {
  return <Tag tone={toneFor(status)}>{text ?? label(status)}</Tag>;
}

export function Avatar({ name, url, size = "sm" }: { name: string | null | undefined; url?: string | null; size?: "sm" | "md" | "lg" }) {
  const src = url?.trim() || null;
  return (
    <div className={`avatar avatar--${size}`} title={name ?? ""} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span>{initials(name)}</span>}
    </div>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= Math.round(value) ? "" : "off"} fill={i <= Math.round(value) ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

export function Empty({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="emptyState">
      {icon ?? <Inbox size={30} />}
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  );
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="loadingPage">
      <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
        <Loader2 size={18} className="spin" /> {text}
      </span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="formMessage error">{message}</div>;
}

export function MetricCard({ icon, label: l, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="metricCard">
      <div className="metricTop">
        <span className="metricLabel">{l}</span>
        {icon}
      </div>
      <span className="metricValue mono">{value}</span>
      {hint && <span className="metricHint">{hint}</span>}
    </div>
  );
}

// ---------- toolbar pieces ----------

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="searchBox">
      <Search size={17} />
      <span className="srOnly">{placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export type ChipOption = { value: string; label: string; count?: number };

export function Chips({ options, value, onChange }: { options: ChipOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={`chip ${value === o.value ? "active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ options, value, onChange }: { options: ChipOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={`tab ${value === o.value ? "active" : ""}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- table ----------

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; align?: "right"; width?: number };

export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRowClick, empty, page, size, total, onPage,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRowClick?: (row: T) => void;
  empty?: { title: string; text?: string };
  page?: number;
  size?: number;
  total?: number;
  onPage?: (p: number) => void;
}) {
  const hasRows = !!rows && rows.length > 0;
  const from = (page ?? 0) * (size ?? 25);

  return (
    <div className="tableCard">
      {error && <div style={{ padding: 16 }}><ErrorNote message={error} /></div>}
      {!hasRows && loading && <Loading />}
      {!hasRows && !loading && !error && <Empty title={empty?.title ?? "Nothing here yet"} text={empty?.text} />}
      {hasRows && (
        <div className="tableScroll" style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <table className="dataTable">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.align === "right" ? "right" : undefined} style={c.width ? { width: c.width } : undefined}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows!.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onRowClick ? "clickable" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === "right" ? "right" : undefined}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {onPage && total !== undefined && total > 0 && (
        <div className="pager">
          <span>
            Showing {from + 1}-{Math.min(from + (rows?.length ?? 0), total)} of {total.toLocaleString("en-ZA")}
          </span>
          <div>
            <button type="button" className="outlineButton smallButton" disabled={(page ?? 0) === 0} onClick={() => onPage((page ?? 0) - 1)}>
              <ChevronLeft size={15} /> Previous
            </button>
            <button type="button" className="outlineButton smallButton" disabled={from + (size ?? 25) >= total} onClick={() => onPage((page ?? 0) + 1)}>
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- overlays ----------

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <div className={`modalCard ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>{title}</h2>
          <button type="button" className="modalClose" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="drawerBackdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawerHead">
          <h2>{title}</h2>
          <div className="rowActions">
            {actions}
            <button type="button" className="modalClose" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="drawerBody">{children}</div>
      </aside>
    </>
  );
}

/**
 * Asks "are you sure?" and, when `minReason` is set, makes the admin write why.
 * The reason goes to the audit log, so teammates can see the thinking later.
 */
export function ConfirmModal({
  open, title, message, confirmLabel, danger, minReason, reasonLabel = "Reason", onConfirm, onClose, children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  minReason?: number;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setReason(""); setError(null); setBusy(false); }
  }, [open]);

  const needsReason = (minReason ?? 0) > 0;
  const tooShort = needsReason && reason.trim().length < (minReason ?? 0);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={title} onClose={busy ? () => undefined : onClose}>
      {message && <p style={{ lineHeight: 1.6, marginBottom: 16 }}>{message}</p>}
      {children}
      {needsReason && (
        <label className="formField">
          <span>{reasonLabel}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="This is saved in the audit log." />
          <small>At least {minReason} characters.</small>
        </label>
      )}
      {error && <div className="formMessage error">{error}</div>}
      <div className="modalActions">
        <button type="button" className="outlineButton" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`primaryButton ${danger ? "dangerButton" : ""}`} onClick={go} disabled={busy || tooShort}>
          {busy && <Loader2 size={16} className="spin" />} {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({ label: l, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="formField">
      <span>{l}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toggle({ on, onChange, disabled, label: l }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={l} className={`switch ${on ? "on" : ""}`} disabled={disabled} onClick={() => onChange(!on)} />;
}
