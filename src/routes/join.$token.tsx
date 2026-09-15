import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";
import { getPracticeJoinInfo, selfSignUpClient } from "@/lib/practice-join.functions";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/join/$token")({
  head: () => ({ meta: [{ title: "Join your practice — Buddy" }] }),
  component: JoinPractice,
});

type Practitioner = { id: string; name: string; isAdmin: boolean };

function JoinPractice() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const loadInfo = useServerFn(getPracticeJoinInfo);
  const signUp = useServerFn(selfSignUpClient);

  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [practiceName, setPracticeName] = useState("your practice");
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [complaint, setComplaint] = useState("");
  const [practitionerId, setPractitionerId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await loadInfo({ data: { token } });
        if (!alive) return;
        if (!res.ok) {
          setLinkError(res.error);
        } else {
          setPracticeName(res.practiceName);
          setPractitioners(res.practitioners);
          if (res.practitioners.length === 1) setPractitionerId(res.practitioners[0].id);
        }
      } catch {
        if (alive) setLinkError("We couldn't open this sign-up link. Please check it and try again.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token, loadInfo]);

  const multi = practitioners.length > 1;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (multi && !practitionerId) {
      setError("Please choose which practitioner you're seeing.");
      return;
    }
    setBusy(true);
    try {
      const res = await signUp({
        data: {
          token,
          fullName: fullName.trim(),
          email: email.trim(),
          password,
          primaryComplaint: complaint.trim(),
          practitionerId: practitionerId || null,
        },
      });
      if (!res.ok) {
        setBusy(false);
        setError(res.error);
        return;
      }
      // Sign the new client straight in.
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) {
        setBusy(false);
        // Account exists; just send them to sign in manually.
        navigate({ to: "/client/login" });
        return;
      }
      setClientId(res.clientId);
      navigate({ to: "/client/app/checkin" });
    } catch {
      setBusy(false);
      setError("Something went wrong. Please try again.");
    }
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
      <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <BuddyLogo />

        {loading ? (
          <p style={{ marginTop: 32, color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
            Opening your sign-up link…
          </p>
        ) : linkError ? (
          <div style={{ marginTop: 32, textAlign: "center" }}>
            <p style={{ color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.5 }}>
              {linkError}
            </p>
          </div>
        ) : (
          <>
            <h1
              style={{
                fontFamily: "var(--font-hero)",
                fontWeight: 400,
                fontSize: 24,
                color: "var(--white)",
                marginTop: 32,
                textAlign: "center",
              }}
            >
              Join {practiceName}
            </h1>
            <p
              style={{
                color: "var(--white-muted)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
                lineHeight: 1.5,
                textAlign: "center",
                margin: "8px 0 4px",
              }}
            >
              Create your account to start checking in with your practitioner.
            </p>

            <form
              onSubmit={onSubmit}
              style={{ width: "100%", marginTop: 24, display: "flex", flexDirection: "column", gap: 14 }}
            >
              <input
                type="text"
                name="name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                aria-label="Full name"
                required
                style={inputStyle}
              />
              <input
                type="email"
                name="email"
                autoComplete="email"
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
              <PasswordInput
                name="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password (8+ characters)"
                ariaLabel="Password"
                required
                minLength={8}
                style={inputStyle}
              />
              <input
                type="text"
                name="complaint"
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                placeholder="What is your complaint?"
                aria-label="What is your complaint?"
                required
                style={inputStyle}
              />

              {multi && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--white-muted)",
                    }}
                  >
                    Which practitioner are you seeing?
                  </span>
                  {practitioners.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPractitionerId(p.id)}
                      style={{
                        width: "100%",
                        minHeight: 48,
                        borderRadius: 8,
                        textAlign: "left",
                        padding: "0 14px",
                        background: practitionerId === p.id ? "var(--blue-accent)" : "var(--navy-card)",
                        border: `1px solid ${practitionerId === p.id ? "var(--blue-accent)" : "var(--navy-border)"}`,
                        color: "var(--white)",
                        fontFamily: "var(--font-ui)",
                        fontSize: 15,
                        cursor: "pointer",
                      }}
                    >
                      {p.name}
                      {p.isAdmin ? "  ·  Practice lead" : ""}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <p role="alert" style={{ color: "var(--red)", textAlign: "center", fontSize: 14 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !fullName || !email || !password || !complaint}
                style={{
                  marginTop: 6,
                  width: "100%",
                  minHeight: 48,
                  borderRadius: 8,
                  background: "var(--blue-accent)",
                  color: "var(--white)",
                  border: "none",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 16,
                  opacity: busy || !fullName || !email || !password || !complaint ? 0.6 : 1,
                }}
              >
                {busy ? "Creating your account…" : "Create account"}
              </button>
            </form>
          </>
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
