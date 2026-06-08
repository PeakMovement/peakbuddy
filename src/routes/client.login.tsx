import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/client/login")({
  head: () => ({ meta: [{ title: "Client Login — Buddy" }] }),
  component: ClientLogin,
});

function ClientLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const trimmedEmail = email.trim();
    // Verify credentials via Supabase auth
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (signInErr) {
      setLoading(false);
      setError("Invalid email or password.");
      return;
    }
    // Keep the auth session active — client-side reads rely on RLS policies
    // that match the authenticated user's email to clients.email.
    const { data: client, error: lookupErr } = await supabase
      .from("clients")
      .select("id")
      .eq("email", trimmedEmail)
      .maybeSingle();
    setLoading(false);
    if (lookupErr || !client) {
      setError("No client record found for this account. Contact your practitioner.");
      return;
    }
    setClientId(client.id);
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
            style={{
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
            }}
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
            style={{
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
            }}
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
        </form>

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
