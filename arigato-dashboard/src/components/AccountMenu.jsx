import { useEffect, useState } from "react";
import { CloudOff, Loader2, LogOut, UserRound, Sparkles, CheckCircle2, ArrowRight, History } from "lucide-react";
import { isMissingTable, loadRecentActivity, signOut, supabase } from "../services/supabaseClient";

const SYNC_TEXT = {
  idle: "Profile synced to cloud",
  saving: "Saving changes…",
  saved: "All changes saved",
  error: "Couldn’t save — will retry",
  "no-table": "Cloud table missing",
};

const EVENT_LABELS = {
  signed_in: () => "Signed in",
  signed_out: () => "Signed out",
  profile_saved: (d) => `Saved farm profile${d.location ? ` · ${d.location}` : ""}`,
  location_changed: (d) => `Changed location to ${d.name ?? "a new place"}`,
  page_view: (d) => `Opened ${d.page}`,
  crop_viewed: (d) => `Viewed ${d.crop} guidance`,
  compare_changed: (d) => `${d.action === "added" ? "Added" : "Removed"} ${d.crop} ${d.action === "added" ? "to" : "from"} comparison`,
  soil_analysis: (d) => `AI soil analysis for ${d.place} · ${d.soilType}`,
  mode_changed: (d) => `Switched to ${d.mode === "personalized" ? "field sensor" : "locality API"} mode`,
};

function timeAgo(iso, now) {
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function RecentActivity({ userId }) {
  const [state, setState] = useState({ status: "loading", items: [] });

  useEffect(() => {
    let cancelled = false;
    loadRecentActivity(userId)
      .then((items) => {
        const now = Date.now();
        if (!cancelled) setState({ status: "ready", items: items.map((a) => ({ ...a, ago: timeAgo(a.created_at, now) })) });
      })
      .catch((err) => !cancelled && setState({ status: isMissingTable(err) ? "no-table" : "error", items: [] }));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="account-activity">
      <span className="account-activity-title"><History size={13} /> Recent activity</span>
      {state.status === "loading" && <span className="account-activity-empty">Loading…</span>}
      {state.status === "no-table" && <span className="account-activity-empty">Activity table missing — run supabase/schema.sql</span>}
      {state.status === "error" && <span className="account-activity-empty">Couldn’t load activity</span>}
      {state.status === "ready" && state.items.length === 0 && <span className="account-activity-empty">No activity yet</span>}
      {state.items.map((a) => (
        <div key={`${a.created_at}-${a.event}`} className="account-activity-item">
          <span>{(EVENT_LABELS[a.event] ?? (() => a.event))(a.details ?? {})}</span>
          <small>{a.ago}</small>
        </div>
      ))}
    </div>
  );
}

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

        <RecentActivity userId={user.id} />

        <div className="account-menu-actions">
          <button type="button" className="account-action-btn edit-profile-btn" onClick={onGoToProfile}>
            <UserRound size={15} />
            <span>Farm Profile & Land</span>
          </button>
          <button type="button" className="account-action-btn signout-btn" onClick={signOut}>
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
