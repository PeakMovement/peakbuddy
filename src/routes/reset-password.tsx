import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set your password — Buddy" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Wait for Supabase to parse the recovery token from the URL hash and
  // establish a session, then let the user pick a new password.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let attempt = 0;
      while (attempt < 25 && !cancelled) {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setReady(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
        attempt++;
      }
      if (!cancelled) {
        setLinkError(
          "This link has expired or is invalid. Please request a new one from the sign in screen.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setLoading(false);
      setError(updErr.message || "Could not update your password. Please try again.");
      return;
    }

    // Route the user home based on their role.
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id ?? null;
    let role = "client";
    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      role = profile?.role ?? "client";
    }

    if (role === "super_admin") {
      navigate({ to: "/admin/app/dashboard" });
      return;
    }
    if (role === "practitioner") {
      const { data: practice } = await supabase
        .from("practices")
        .select("onboarding_complete,is_approved")
        .eq("practitioner_id", userId!)
        .maybeSingle();
      if (practice && practice.is_approved === false) {
        navigate({ to: "/practitioner/pending" });
        return;
      }
      navigate({
        to: practice?.onboarding_complete
          ? "/practitioner/app/dashboard"
          : "/practitioner/onboarding",
      });
      return;
    }

    if (userId) {
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (client) setClientId(client.id);
    }
    navigate({ to: "/client/app/checkin" });
  };

  return (
    <main
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <BuddyLogo />
        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 24,
            color: "var(--white)",
            marginTop: 36,
            textAlign: "center",
          }}
        >
          Set your password
        </h1>

        {linkError ? (
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <p
              style={{
                color: "var(--white-muted)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {linkError}
            </p>
            <Link
              to="/client/login"
              style={{
                display: "inline-block",
                marginTop: 20,
                color: "var(--blue-accent)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Go to sign in
            </Link>
          </div>
        ) : !ready ? (
          <p
            style={{
              marginTop: 32,
              color: "var(--white-muted)",
              fontFamily: "var(--font-ui)",
              fontSize: 14,
            }}
          >
            Preparing your reset link…
          </p>
        ) : (
          <form
            onSubmit={onSubmit}
            style={{
              width: "100%",
              marginTop: 32,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              <p
                role="alert"
                style={{
                  color: "var(--red)",
                  marginTop: 4,
                  textAlign: "center",
                  fontSize: 14,
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password || !confirm}
              style={{
                marginTop: 10,
                width: "100%",
                minHeight: 48,
                borderRadius: 8,
                background: "var(--blue-accent)",
                color: "var(--white)",
                border: "none",
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 16,
                opacity: loading || !password || !confirm ? 0.6 : 1,
              }}
            >
              {loading ? "Saving…" : "Save password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderRadius: 8,
  border: "1px solid var(--navy-border)",
  background: "var(--navy-card)",
  color: "var(--white)",
  padding: "0 14px",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
};
