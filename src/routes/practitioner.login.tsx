import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/practitioner/login")({
  head: () => ({ meta: [{ title: "Practitioner Login — Buddy" }] }),
  component: () => (
    <main
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 32, color: "var(--white)" }}>
        Practitioner Login
      </h1>
      <p style={{ marginTop: 12, color: "var(--white-muted)" }}>Coming soon.</p>
      <Link
        to="/"
        style={{ marginTop: 32, color: "var(--blue-cold)", textDecoration: "underline" }}
      >
        Back home
      </Link>
    </main>
  ),
});
