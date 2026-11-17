import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { sb, supabase } from "./supabase";

export type AdminProfile = { user_id: string; full_name: string | null; email: string };

type AuthContextValue = {
  user: User | null;
  admin: AdminProfile | null;
  loading: boolean;
  notice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Admins are signed out after this long without any activity. */
const IDLE_LIMIT_MS = 30 * 60 * 1000;

type AdminCheck = { profile: AdminProfile } | { reason: string };

/** Says exactly why an account was refused, so a setup problem is easy to spot. */
async function loadAdmin(userId: string): Promise<AdminCheck> {
  const { data, error } = await sb()
    .from("profiles")
    .select("user_id, role, full_name, email, is_suspended")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return { reason: `Signed in, but the profile couldn't be read (${error.message}). Has supabase/admin-setup.sql been run?` };
  }
  if (!data) return { reason: "Signed in, but this account has no row in the profiles table." };
  if (data.is_suspended) return { reason: "This account is suspended." };
  if (data.role !== "admin") return { reason: `This account doesn't have admin access (its role is "${data.role}").` };
  return { profile: { user_id: data.user_id, full_name: data.full_name, email: data.email } };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const lastActive = useRef(Date.now());

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setAdmin(null);
  }, []);

  // Accept a session only if it belongs to an active admin.
  const accept = useCallback(async (sessionUser: User | null) => {
    if (!sessionUser) {
      setUser(null);
      setAdmin(null);
      return;
    }
    const check = await loadAdmin(sessionUser.id);
    if ("reason" in check) {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAdmin(null);
      setNotice(check.reason);
      return;
    }
    setUser(sessionUser);
    setAdmin(check.profile);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      await accept(data.session?.user ?? null);
      if (active) setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setAdmin(null);
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [accept]);

  // Idle timeout: an unattended admin session is the easiest way in for the wrong person.
  useEffect(() => {
    if (!user) return;
    const bump = () => { lastActive.current = Date.now(); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LIMIT_MS) {
        setNotice("You were signed out after 30 minutes of inactivity.");
        void signOut();
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, [user, signOut]);

  async function signIn(email: string, password: string) {
    setNotice(null);
    const client = sb();
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);

    const check = await loadAdmin(data.user.id);
    if ("reason" in check) {
      await client.auth.signOut();
      throw new Error(check.reason);
    }
    lastActive.current = Date.now();
    setUser(data.user);
    setAdmin(check.profile);
  }

  return <AuthContext.Provider value={{ user, admin, loading, notice, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
