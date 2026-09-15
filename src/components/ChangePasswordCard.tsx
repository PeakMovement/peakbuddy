import { useState } from "react";
import { KeyRound } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Reusable "Change password" card for the client profile and the
 * practitioner / admin settings screens. Verifies the current password
 * (re-authenticates the signed-in user) before setting the new one, so a
 * left-open session can't be used to silently take over the account.
 */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from your current one.");
      return;
    }

    setBusy(true);
    try {
      // Confirm identity by re-authenticating with the current password.
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email) {
        setBusy(false);
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (authErr) {
        setBusy(false);
        setError("Current password is incorrect.");
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: next });
      setBusy(false);
      if (updErr) {
        setError(updErr.message || "Could not update your password. Please try again.");
        return;
      }
      reset();
      setNotice("Password updated. Use it next time you sign in.");
    } catch {
      setBusy(false);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound size={16} color="var(--blue-accent)" />
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            color: "var(--white)",
          }}
        >
          Change password
        </h2>
      </div>

      <p style={{ color: "var(--white-muted)", fontSize: 13, lineHeight: 1.5 }}>
        Enter your current password, then choose a new one (at least 8 characters).
      </p>

      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="password"
          name="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          aria-label="Current password"
          required
          style={inputStyle}
        />
        <input
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password"
          aria-label="New password"
          required
          minLength={8}
          style={inputStyle}
        />
        <input
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          aria-label="Confirm new password"
          required
          minLength={8}
          style={inputStyle}
        />

        {error && (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13 }}>
            {error}
          </p>
        )}
        {notice && <p style={{ color: "var(--white-muted)", fontSize: 12 }}>{notice}</p>}

        <button
          type="submit"
          disabled={busy || !current || !next || !confirm}
          style={{
            marginTop: 4,
            width: "100%",
            minHeight: 44,
            borderRadius: 8,
            background: "var(--blue-accent)",
            border: "none",
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            cursor: busy || !current || !next || !confirm ? "default" : "pointer",
            opacity: busy || !current || !next || !confirm ? 0.6 : 1,
          }}
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--navy-border)",
  background: "var(--navy)",
  color: "var(--white)",
  padding: "0 14px",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
};

export default ChangePasswordCard;
