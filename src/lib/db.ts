import { sb } from "./supabase";

export const PAGE_SIZE = 25;

export type PageResult<T> = { rows: T[]; total: number };

type Opts = {
  select?: string;
  page: number;
  size?: number;
  order?: { col: string; asc?: boolean }[];
  search?: { cols: string[]; term: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply?: (q: any) => any;
};

/** A page of rows from a table or admin view, with a total for the pager. */
export async function pageQuery<T>(source: string, o: Opts): Promise<PageResult<T>> {
  const size = o.size ?? PAGE_SIZE;
  let q = sb().from(source).select(o.select ?? "*", { count: "exact" });
  if (o.apply) q = o.apply(q);

  const term = (o.search?.term ?? "").replace(/[,()%*\\]/g, " ").trim();
  if (term && o.search) {
    q = q.or(o.search.cols.map((c) => `${c}.ilike.%${term}%`).join(","));
  }
  for (const ord of o.order ?? []) q = q.order(ord.col, { ascending: ord.asc ?? false });

  const from = o.page * size;
  const { data, error, count } = await q.range(from, from + size - 1);
  if (error) throw error;
  return { rows: (data ?? []) as T[], total: count ?? 0 };
}

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  return data as T;
}

/** Runs one of our admin Edge Functions and turns any failure into a readable message. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.json();
        if (payload?.error) message = String(payload.error);
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message);
  }
  return data as T;
}

/** Records an admin action in the audit log. Never blocks the action it describes. */
export function logAction(action: string, table?: string, id?: string, summary?: string, detail?: Record<string, unknown>) {
  return sb()
    .rpc("admin_log", { p_action: action, p_target_table: table ?? null, p_target_id: id ?? null, p_summary: summary ?? null, p_detail: detail ?? {} })
    .then(() => undefined, () => undefined);
}

/** Downloads rows as a CSV file (opens fine in Excel). */
export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Stops spreadsheet formulas from running if a cell starts with = + - or @
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${head}\n${body}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Extra safe wrapper: escape user text before putting it inside a mailto link. */
export const mailto = (to: string, subject: string, body = "") =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
