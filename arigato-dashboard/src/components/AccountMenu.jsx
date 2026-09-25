import { useState } from "react";
import { CloudOff, Loader2, LogOut, UserRound } from "lucide-react";
import { supabase } from "../services/supabaseClient";

const SYNC_TEXT = {
  idle: "Profile synced to your account",
  saving: "Saving…",
  saved: "All changes saved",
  error: "Couldn’t save — will retry on next change",
  "no-table": "Database table missing — run supabase/schema.sql",
};

export default function AccountMenu({ session, syncStatus, onGoToProfile }) {
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  if (!supabase) {
    return (
      <div className="account-pop">
        <div className="account-note"><CloudOff size={16} /> Supabase isn’t configured. Your profile is saved in this browser only.</div>
      </div>
    );
  }

  if (session) {
    const user = session.user;
    const name = user.user_metadata?.full_name || user.email;
    return (
      <div className="account-pop">
        <div className="account-head">
          <span className="account-avatar">{name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <p className={`account-sync sync-${syncStatus}`}>{SYNC_TEXT[syncStatus] ?? SYNC_TEXT.idle}</p>
        <button className="btn btn-soft btn-sm btn-block-sm" onClick={onGoToProfile}>
          <UserRound size={14} /> Edit farm profile
        </button>
        <button className="btn btn-ghost btn-sm btn-block-sm" onClick={() => supabase.auth.signOut()}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    );
  }

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { email, password, name } = form;
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setBusy(false);
    if (error) setMessage({ tone: "poor", text: error.message });
    else if (mode === "signup" && !data.session)
      setMessage({ tone: "good", text: "Check your email to confirm your account, then sign in." });
  };

  return (
    <form className="account-pop" onSubmit={submit}>
      <strong className="account-title">{mode === "signin" ? "Sign in to save your farm" : "Create your farmer account"}</strong>
      <span className="muted small">Your land profile and crop choices sync across devices.</span>
      {mode === "signup" && (
        <input className="account-input" placeholder="Full name" value={form.name} onChange={set("name")} autoComplete="name" />
      )}
      <input className="account-input" type="email" placeholder="Email" required value={form.email} onChange={set("email")} autoComplete="email" />
      <input
        className="account-input"
        type="password"
        placeholder="Password (min 6 characters)"
        required
        minLength={6}
        value={form.password}
        onChange={set("password")}
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
      />
      {message && <span className={`account-msg tone-${message.tone}`}>{message.text}</span>}
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
        {busy && <Loader2 size={14} className="spin" />}
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
