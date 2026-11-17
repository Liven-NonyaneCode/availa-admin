import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import BrandMark from "../components/BrandMark";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import { errorMessage } from "../lib/useAsync";

export default function Login() {
  const { admin, loading, notice, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && admin) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="loginPage">
      <form className="card loginCard" onSubmit={submit}>
        <BrandMark tag />
        <h1>Sign in</h1>
        <p>For the Availa team only. Every action you take here is recorded.</p>
        {!supabase && <div className="formMessage error">Supabase isn't configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.</div>}
        {notice && !error && <div className="formMessage warn">{notice}</div>}
        {error && <div className="formMessage error">{error}</div>}
        <label className="formField">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="formField">
          <span>Password</span>
          <div className="passwordFieldWrap">
            <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="passwordToggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} tabIndex={-1}>
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <button type="submit" className="primaryButton fullButton" disabled={busy || !supabase}>
          {busy && <Loader2 size={16} className="spin" />} Sign in
        </button>
      </form>
    </div>
  );
}
