import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BuddyLogo } from "@/components/CrosshairLogo";
import { registerPractitioner, checkSignupReady } from "@/lib/practitioner-signup.functions";

export const Route = createFileRoute("/practitioner/signup")({
  head: () => ({ meta: [{ title: "Request Access — Buddy" }] }),
  component: PractitionerSignup,
});

const PROFESSIONS = [
  "Physiotherapist",
  "Biokineticist",
  "Chiropractor",
  "Sports Scientist",
  "Personal Trainer",
  "Strength and Conditioning Coach",
  "Other",
];

function PractitionerSignup() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profession, setProfession] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim() || !email.trim() || !profession) {
      setError("All fields are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    // Preflight: confirm the server is configured before we create an auth
    // user. Without this, a missing SEED_SERVICE_ROLE_KEY leaves an orphan
    // auth account and the user can never retry with the same email.
    const ready = await checkSignupReady().catch(() => ({ ok: false }));
    if (!ready.ok) {
      setLoading(false);
      setError("Signup is temporarily unavailable. Please contact support.");
      return;
    }
    const { data: signUp, error: authErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/practitioner/login`,
        data: { full_name: fullName.trim(), profession },
      },
    });
    if (authErr) {
      setLoading(false);
      const msg = authErr.message.toLowerCase();
      if (msg.includes("registered") || msg.includes("already")) {
        setError("Email already registered.");
      } else {
        setError(authErr.message);
      }
      return;
    }
    const userId = signUp.user?.id;
    // Supabase returns an obfuscated user object with `identities: []` when the
    // email is already registered (anti-enumeration). Detect and surface a
    // clear error instead of attempting a profiles insert that will FK-fail.
    if (signUp.user && (signUp.user.identities?.length ?? 0) === 0) {
      setLoading(false);
      setError("Email already registered.");
      return;
    }
    if (!userId) {
      setLoading(false);
      setError("Could not create account. Please try again.");
      return;
    }
    const result = await registerPractitioner({
      data: {
        userId,
        fullName: fullName.trim(),
        email: email.trim(),
        profession,
      },
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(true);
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
          maxWidth: 380,
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
            fontSize: 26,
            color: "var(--white)",
            marginTop: 32,
            textAlign: "center",
          }}
        >
          Request Access
        </h1>

        {success ? (
          <div
            style={{
              marginTop: 32,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <CheckCircle2 size={56} color="var(--green)" />
            <h2
              style={{
                fontFamily: "var(--font-hero)",
                fontWeight: 400,
                fontSize: 22,
                color: "var(--white)",
                marginTop: 20,
              }}
            >
              Check your email
            </h2>
            <p
              style={{ color: "var(--white-muted)", fontSize: 14, marginTop: 12, lineHeight: 1.5 }}
            >
              Check your email to confirm your account. Once confirmed, log in to complete your
              setup.
            </p>
            <Link
              to="/practitioner/login"
              style={{
                marginTop: 32,
                color: "var(--blue-accent)",
                fontSize: 14,
                textDecoration: "underline",
              }}
            >
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <form
              onSubmit={onSubmit}
              style={{
                width: "100%",
                marginTop: 28,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <Field label="Full name">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={inputStyle}
                  required
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  required
                />
              </Field>
              <Field label="Profession">
                <select
                  value={profession}
                  onChange={(e) => setProfession(e.target.value)}
                  style={{ ...inputStyle, appearance: "none" }}
                  required
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {PROFESSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Password">
                <div style={{ position: "relative" }}>
                  <input
                    type={show ? "text" : "password"}
                    name="new-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, paddingRight: 48 }}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    aria-label={show ? "Hide password" : "Show password"}
                    onClick={() => setShow((s) => !s)}
                    style={eyeBtn}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm password">
                <input
                  type={show ? "text" : "password"}
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  style={inputStyle}
                  minLength={8}
                  required
                />
              </Field>

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
                  cursor: "pointer",
                }}
              >
                {loading ? "Creating account…" : "Create my account"}
              </button>
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
              Creating an account is free. Practice subscriptions, where applicable, are arranged
              directly with Peak Movement outside the app. There are no purchases inside the app.
            </p>

            <Link
              to="/practitioner/login"
              style={{
                marginTop: 28,
                color: "var(--white-muted)",
                fontSize: 14,
                textDecoration: "underline",
                textUnderlineOffset: 4,
              }}
            >
              Already have an account? Log in
            </Link>
          </>
        )}
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

const eyeBtn: React.CSSProperties = {
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
