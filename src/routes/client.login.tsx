import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/client/login")({
  head: () => ({ meta: [{ title: "Client Login — Buddy" }] }),
  component: ClientLogin,
});

const REMEMBER_KEY = "buddy.remember_me";
const EMAIL_KEY = "buddy.remember_email";

function ClientLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicNotice, setMagicNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Restore last preference
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(REMEMBER_KEY);
    if (stored === "false") setRemember(false);
    const savedEmail = window.localStorage.getItem(EMAIL_KEY);
    if (savedEmail) setEmail(savedEmail);
  }, []);

  // Cooldown tick for the magic-link button
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // If user opts out of remember-me, sign out when the tab/app closes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
    if (!remember) window.localStorage.removeItem(EMAIL_KEY);
    if (remember) return;
    const handler = () => {
      void supabase.auth.signOut();
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [remember]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMagicNotice(null);
    setLoading(true);
    const trimmedEmail = email.trim();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (signInErr) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }

    if (typeof window !== "undefined") {
      if (remember) window.localStorage.setItem(EMAIL_KEY, trimmedEmail);
      else window.localStorage.removeItem(EMAIL_KEY);
    }
    const { data: authData } = await supabase.auth.getUser();
    const authUserId = authData.user?.id ?? null;

    let client: { id: string } | null = null;
    if (authUserId) {
      const { data } = await supabase
        .from("clients")
        .select("id")
        .eq("auth_user_id", authUserId)
        .maybeSingle();
      client = data ?? null;
    }
    if (!client) {
      const { data } = await supabase
        .from("clients")
        .select("id")
        .ilike("email", trimmedEmail)
        .maybeSingle();
      client = data ?? null;
    }
    setLoading(false);
    if (!client) {
      setError("No client record found for this account. Contact your practitioner.");
      return;
    }
    setClientId(client.id);
    navigate({ to: "/client/app/checkin" });
  };

  const onMagicLink = async () => {
    setError(null);
    setMagicNotice(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email above, then tap 'Email me a sign-in link'.");
      return;
    }
    setMagicLoading(true);
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setMagicLoading(false);
    if (otpErr) {
      // Don't reveal whether the email exists.
      setMagicNotice("If that email is registered, a sign-in link is on its way.");
    } else {
      setMagicNotice("Check your inbox — tap the link to sign in. It expires in 15 minutes.");
    }
    setCooldown(60);
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
          Sign in
        </h1>

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
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            required
            style={inputStyle}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            required
            style={inputStyle}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--white-muted)",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              marginTop: 2,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--blue-accent)" }}
            />
            Keep me signed in on this device
          </label>

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
            disabled={loading || !email || !password}
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
              opacity: loading || !email || !password ? 0.6 : 1,
            }}
          >
            {loading ? "Signing in…" : "Log in"}
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              margin: "6px 0 2px",
              color: "var(--white-muted)",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "var(--navy-border)" }} />
            or
            <span style={{ flex: 1, height: 1, background: "var(--navy-border)" }} />
          </div>

          <button
            type="button"
            onClick={onMagicLink}
            disabled={magicLoading || cooldown > 0}
            style={{
              width: "100%",
              minHeight: 48,
              borderRadius: 8,
              background: "transparent",
              color: "var(--white)",
              border: "1px solid var(--navy-border)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 15,
              opacity: magicLoading || cooldown > 0 ? 0.6 : 1,
            }}
          >
            {magicLoading
              ? "Sending…"
              : cooldown > 0
                ? `Email a sign-in link (${cooldown}s)`
                : "Email me a sign-in link"}
          </button>

          {magicNotice && (
            <p
              style={{
                color: "var(--white)",
                fontSize: 13,
                textAlign: "center",
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              {magicNotice}
            </p>
          )}
        </form>

        <p
          style={{
            marginTop: 20,
            color: "var(--white-muted)",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Your practitioner gives you a login code. There is no charge to you and nothing to buy
          inside the app.
        </p>

        <Link
          to="/practitioner/login"
          style={{
            marginTop: 48,
            color: "var(--white-muted)",
            fontSize: 14,
            textDecoration: "underline",
            textUnderlineOffset: 4,
          }}
        >
          Are you a practitioner? Log in here
        </Link>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 52,
  borderRadius: 8,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
  padding: "0 16px",
  outline: "none",
};
