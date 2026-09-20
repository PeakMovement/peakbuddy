import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";
import { PasswordInput } from "@/components/PasswordInput";
import { clearQuickCode } from "@/lib/quick-login.functions";
import { markQuickCodeSession } from "@/lib/quick-login";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — Buddy" },
      {
        name: "description",
        content: "Choose a new password for your Buddy account.",
      },
      { property: "og:title", content: "Reset Password — Buddy" },
      {
        property: "og:description",
        content: "Choose a new password for your Buddy account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
  const [saved, setSaved] = useState(false);

  // Wait for Supabase to parse the recovery token from the URL hash and
  // establish a session, then let the user pick a new password.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const tryRecover = async () => {
      const hash = window.location.hash?.slice(1) ?? "";
      const params = new URLSearchParams(hash);
      const query = new URLSearchParams(window.location.search);

      // An expired / already-used one-time token comes back as an explicit error
      // in the link — show that plainly instead of a vague "invalid".
      const errCode =
        params.get("error_code") ||
        query.get("error_code") ||
        params.get("error") ||
        query.get("error");
      const errDesc = params.get("error_description") || query.get("error_description");

      // Every token format Supabase might deliver a recovery link in:
      const tokenHash = query.get("token_hash") || params.get("token_hash");
      const otpType = (query.get("type") || params.get("type")) as
        | "recovery"
        | "email"
        | "magiclink"
        | "signup"
        | "invite"
        | null;
      const code = query.get("code");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      const hasRecoveryToken =
        !!tokenHash || !!code || !!accessToken || params.get("type") === "recovery";

      let recovered = false;
      const acceptSession = () => {
        if (cancelled || recovered) return;
        recovered = true;
        setLinkError(null);
        setReady(true);
        clearRecoveryUrl();
      };

      if (errCode) {
        setLinkError(
          "This reset link has expired or was already used. Please request a new one from the sign in screen." +
            (errDesc ? ` (${errDesc.replace(/\+/g, " ")})` : ""),
        );
        return;
      }

      // Establish the session from whichever token format the link carries.
      // token_hash (verifyOtp) is the scanner-safe format; ?code= is PKCE;
      // #access_token=… is the implicit hash format.
      try {
        if (tokenHash && otpType) {
          await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(window.location.href);
        } else if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }
      } catch {
        /* fall through to the listener + polling checks below */
      }

      // Also catch the session if the client parsed the link on its own.
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (
          (event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION" || event === "SIGNED_IN") &&
          session?.user
        ) {
          acceptSession();
        }
      });
      unsubscribe = () => listener.subscription.unsubscribe();

      // The auth client can consume and remove the URL hash before React mounts.
      // Check the resulting session even when the token is no longer visible.
      for (let attempt = 0; attempt < 50; attempt++) {
        if (cancelled) break;
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (hasRecoveryToken && sessionData.session?.user) {
          acceptSession();
          break;
        }
        if (sessionError && hasRecoveryToken) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      if (!cancelled && !recovered) {
        setLinkError(
          hasRecoveryToken
            ? "This link has expired or has already been used. Please request a new one from the sign in screen."
            : "This link is invalid. Please request a new one from the sign in screen.",
        );
      }
    };

    const clearRecoveryUrl = () => {
      if (window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };

    void tryRecover();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const msg = updErr.message?.toLowerCase() ?? "";
      if (msg.includes("expired") || msg.includes("invalid")) {
        setError("This reset link has expired. Please request a new one.");
      } else if (msg.includes("weak") || msg.includes("strength")) {
        setError("Please choose a stronger password.");
      } else {
        setError(updErr.message || "Could not update your password. Please try again.");
      }
      return;
    }

    // A password reset always retires any existing 4-digit quick code.
    try {
      await clearQuickCode({});
    } catch {
      /* non-fatal */
    }
    markQuickCodeSession(false);
    setSaved(true);

    // Give the user a moment to see the success state, then route by role.
    setTimeout(async () => {
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
        if (!userId) {
          navigate({ to: "/practitioner/login" });
          return;
        }
        const { data: practice } = await supabase
          .from("practices")
          .select("onboarding_complete,is_approved")
          .eq("practitioner_id", userId)
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
    }, 1200);
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
        ) : saved ? (
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <p
              style={{
                color: "var(--white)",
                fontFamily: "var(--font-ui)",
                fontSize: 16,
                lineHeight: 1.5,
                marginBottom: 8,
              }}
            >
              Password saved.
            </p>
            <p
              style={{
                color: "var(--white-muted)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Taking you to the app…
            </p>
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
            <PasswordInput
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              ariaLabel="New password"
              required
              minLength={8}
              style={inputStyle}
            />
            <PasswordInput
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              ariaLabel="Confirm new password"
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
