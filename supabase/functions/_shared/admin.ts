// Shared helpers for the admin Edge Functions.
// These run on the server with the service role key, so every function MUST call
// requireAdmin() before doing anything.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error(err instanceof Error ? err.message : "unknown error"); // never log request bodies
  return json({ error: "Something went wrong on our side. Please try again." }, 500);
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Confirms the caller is signed in AND is an active admin. Returns their id. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<{ id: string; email: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Please sign in.");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("APP_SUPABASE_KEY");
  const client = createClient(Deno.env.get("SUPABASE_URL")!, anonKey!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  if (error || !data.user) throw new HttpError(401, "Please sign in.");

  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_suspended")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.is_suspended) {
    throw new HttpError(403, "This account doesn't have admin access.");
  }
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** Appends to the admin audit log. `detail` must never contain ID numbers, names or image data. */
export async function audit(
  admin: SupabaseClient,
  actorId: string,
  action: string,
  targetTable: string,
  targetId: string,
  summary: string,
  detail: Record<string, unknown> = {},
) {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: actorId,
    action,
    target_table: targetTable,
    target_id: targetId,
    summary,
    detail,
  });
  if (error) console.error("audit insert failed:", error.message);
}

// ---- Paystack (only the admin-money function uses these) ----

export function secretKey(): string {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return key;
}

export const toCents = (amount: number | string): number => Math.round(Number(amount) * 100);

export async function paystack<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; message: string; data: T }> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  return { ok: res.ok && payload.status === true, message: payload.message ?? "", data: payload.data as T };
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
