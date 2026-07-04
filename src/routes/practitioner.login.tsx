import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/practitioner/login")({
  head: () => ({ meta: [{ title: "Practitioner Login — Buddy" }] }),
  component: PractitionerLogin,
});

const REMEMBER_KEY = "buddy.remember_me";
const EMAIL_KEY = "buddy.remember_email";

function PractitionerLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [magicNotice, setMagicNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(REMEMBER_KEY);
    if (stored === "false") setRemember(false);
    const savedEmail = window.localStorage.getItem(EMAIL_KEY);
    if (savedEmail) setEmail(savedEmail);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

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

    const { data: signIn, error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authErr || !signIn.user) {
      setLoading(false);
      setError("Email or password incorrect.");
      return;
    }

    if (typeof window !== "undefined") {
      if (remember) window.localStorage.setItem(EMAIL_KEY, email.trim());
      else window.localStorage.removeItem(EMAIL_KEY);
    }

    const userId = signIn.user.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (!profile || profile.role !== "practitioner") {
      await supabase.auth.signOut();
      setLoading(false);
      setError("Access denied.");
      return;
    }

    const { data: practice } = await supabase
      .from("practices")
      .select("onboarding_complete,is_approved")
      .eq("practitioner_id", userId)
      .maybeSingle();

    setLoading(false);
    if (practice && practice.is_approved === false) {
      navigate({ to: "/practitioner/pending" });
      return;
    }
    if (practice?.onboarding_complete) {
      navigate({ to: "/practitioner/app/dashboard" });
    } else {
      navigate({ to: "/practitioner/onboarding" });
    }
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
          Practitioner Login
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
          <Field label="Email">
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </Field>

          <Field label="Password">
            <div style={{ position: "relative" }}>
              <input
                type={show ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: 48 }}
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => setShow((s) => !s)}
                style={{
                  position: "absolute",
                  right: 2,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "var(--white-muted)",
                  minWidth: 44,
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--white-muted)",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
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
            <p role="alert" style={{ color: "var(--red)", fontSize: 13, textAlign: "center" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 48,
              borderRadius: 8,
              background: "var(--blue-accent)",
              color: "var(--white)",
              border: "none",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              opacity: loading ? 0.6 : 1,
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


        <Link
          to="/practitioner/signup"
          style={{
            marginTop: 32,
            color: "var(--blue-accent)",
            fontSize: 14,
            textDecoration: "underline",
            textUnderlineOffset: 4,
          }}
        >
          New to Buddy? Request access
        </Link>

        <Link
          to="/"
          style={{
            marginTop: 20,
            color: "var(--white-muted)",
            fontSize: 14,
            textDecoration: "underline",
            textUnderlineOffset: 4,
          }}
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 8,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
  padding: "0 14px",
  outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--white-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
