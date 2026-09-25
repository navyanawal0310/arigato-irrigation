import { useState } from "react";
import { CloudOff, Loader2, LogOut, UserRound, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "../services/supabaseClient";

const SYNC_TEXT = {
  idle: "Profile synced to cloud",
  saving: "Saving changes…",
  saved: "All changes saved",
  error: "Couldn’t save — will retry",
  "no-table": "Cloud table missing",
};

export default function AccountMenu({ session, syncStatus, onGoToProfile, onEnterDashboard, isGateway = false }) {
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  if (!supabase) {
    return (
      <div className={`account-pop ${isGateway ? "is-gateway" : ""}`}>
        <div className="account-note">
          <CloudOff size={16} className="text-amber" />
          <span>Supabase isn’t configured. Farm profile is saved locally in this browser.</span>
        </div>
        {onEnterDashboard && (
          <button type="button" className="account-submit-btn gateway-enter-btn" onClick={onEnterDashboard}>
            <span>Enter Farm Dashboard</span>
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    );
  }

  if (session) {
    const user = session.user;
    const name = user.user_metadata?.full_name || user.email?.split("@")[0] || "Farmer";
    const initial = (name[0] || "F").toUpperCase();

    return (
      <div className={`account-pop ${isGateway ? "is-gateway" : ""}`}>
        <div className="account-user-card">
          <div className="account-avatar-ring">
            <span className="account-avatar">{initial}</span>
          </div>
          <div className="account-user-info">
            <span className="account-user-name">{name}</span>
            <span className="account-user-email">{user.email}</span>
          </div>
        </div>

        <div className={`account-sync-badge sync-${syncStatus || "idle"}`}>
          <span className="sync-pulse-dot" />
          <span>{SYNC_TEXT[syncStatus] ?? SYNC_TEXT.idle}</span>
        </div>

        {onEnterDashboard && (
          <button type="button" className="account-submit-btn gateway-enter-btn" onClick={onEnterDashboard}>
            <span>Enter Farm Dashboard</span>
            <ArrowRight size={15} />
          </button>
        )}

        <div className="account-menu-actions">
          <button type="button" className="account-action-btn edit-profile-btn" onClick={onGoToProfile}>
            <UserRound size={15} />
            <span>Farm Profile & Land</span>
          </button>
          <button type="button" className="account-action-btn signout-btn" onClick={() => supabase.auth.signOut()}>
            <LogOut size={15} />
            <span>Sign out</span>
          </button>
        </div>
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
    if (error) {
      setMessage({ tone: "poor", text: error.message });
    } else {
      if (mode === "signin" && onEnterDashboard) {
        onEnterDashboard();
      } else if (mode === "signup") {
        if (data.session && onEnterDashboard) {
          onEnterDashboard();
        } else {
          setMessage({ tone: "good", text: "Confirmation email sent! Check your inbox." });
        }
      }
    }
  };

  return (
    <form className={`account-pop ${isGateway ? "is-gateway" : ""}`} onSubmit={submit}>
      <div className="account-card-header">
        <div className="account-badge-icon">
          <Sparkles size={16} />
        </div>
        <div className="account-card-titles">
          <h4 className="account-title">
            {mode === "signin" ? "Sign in to your farm" : "Create farmer account"}
          </h4>
          <p className="account-subtitle">
            Sync soil profile, advisory, & multi-device settings
          </p>
        </div>
      </div>

      <div className="account-form-body">
        {mode === "signup" && (
          <div className="account-field">
            <input
              className="account-input"
              placeholder="Your full name"
              value={form.name}
              onChange={set("name")}
              autoComplete="name"
            />
          </div>
        )}
        <div className="account-field">
          <input
            className="account-input"
            type="email"
            placeholder="Email address"
            required
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
          />
        </div>
        <div className="account-field">
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
        </div>
      </div>

      {message && (
        <div className={`account-msg tone-${message.tone}`}>
          {message.tone === "good" ? <CheckCircle2 size={14} /> : null}
          <span>{message.text}</span>
        </div>
      )}

      <button className="account-submit-btn" type="submit" disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" /> : null}
        <span>{mode === "signin" ? "Sign in" : "Create account"}</span>
      </button>

      <button
        type="button"
        className="account-toggle-btn"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
      >
        {mode === "signin" ? (
          <>New here? <span className="highlight">Create an account</span></>
        ) : (
          <>Already have an account? <span className="highlight">Sign in</span></>
        )}
      </button>

      {isGateway && onEnterDashboard && (
        <>
          <div className="gateway-guest-divider">
            <span className="divider-line" />
            <span className="divider-text">or explore</span>
            <span className="divider-line" />
          </div>
          <button
            type="button"
            className="gateway-guest-btn"
            onClick={onEnterDashboard}
          >
            <span>Explore Dashboard as Guest</span>
            <ArrowRight size={14} />
          </button>
        </>
      )}
    </form>
  );
}
