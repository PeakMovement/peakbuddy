import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/admin/login")({
  head: () => ({ meta: [{ title: "Admin Login — Buddy" }] }),
  component: AdminLogin,
});

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 8,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  padding: "0 14px",
  outline: "none",
};

function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", signIn.user.id)
      .maybeSingle();

    if (!profile || profile.role !== "super_admin") {
      await supabase.auth.signOut();
      setLoading(false);
      setError("Access denied.");
      return;
    }

    setLoading(false);
    navigate({ to: "/admin/app/dashboard" });
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
          Admin Login
        </h1>

        <form onSubmit={onSubmit} style={{ width: "100%", marginTop: 32, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={fieldLabel}>Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={fieldLabel}>Password</span>
            <div style={{ position: "relative" }}>
              <input
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: 44 }}
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => setShow((s) => !s)}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  color: "var(--white-muted)",
                  padding: 8,
                  cursor: "pointer",
                  display: "flex",
                }}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
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
        </form>

        <Link
          to="/"
          style={{
            marginTop: 40,
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

const fieldLabel: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
