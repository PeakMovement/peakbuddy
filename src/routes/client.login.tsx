import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { CrosshairLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/client/login")({
  head: () => ({ meta: [{ title: "Client Login — Buddy" }] }),
  component: ClientLogin,
});

function ClientLogin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error: err } = await supabase
      .from("clients")
      .select("id")
      .eq("login_code", code.trim())
      .maybeSingle();
    setLoading(false);
    if (err || !data) {
      setError("Code not recognised. Check with your practitioner.");
      return;
    }
    setClientId(data.id);
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
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <CrosshairLogo size={56} />
        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 32,
            color: "var(--white)",
            marginTop: 28,
            textAlign: "center",
          }}
        >
          Enter your access code
        </h1>

        <form onSubmit={onSubmit} style={{ width: "100%", marginTop: 32 }}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="••••"
            aria-label="Access code"
            style={{
              width: "100%",
              height: 64,
              borderRadius: 8,
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              color: "var(--white)",
              fontFamily: "var(--font-data)",
              fontSize: 28,
              textAlign: "center",
              letterSpacing: "0.5em",
              padding: "0 16px",
              outline: "none",
            }}
          />

          {error && (
            <p
              role="alert"
              style={{
                color: "var(--red)",
                marginTop: 16,
                textAlign: "center",
                fontSize: 14,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.length === 0}
            style={{
              marginTop: 24,
              width: "100%",
              minHeight: 48,
              borderRadius: 8,
              background: "var(--blue-accent)",
              color: "var(--white)",
              border: "none",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              opacity: loading || code.length === 0 ? 0.6 : 1,
            }}
          >
            {loading ? "Checking…" : "Log in"}
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
