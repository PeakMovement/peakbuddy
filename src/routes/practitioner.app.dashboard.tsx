import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/practitioner/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Buddy" }] }),
  component: () => (
    <div style={{ padding: "32px 20px", color: "var(--white)" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 32 }}>Dashboard</h1>
      <p style={{ marginTop: 12, color: "var(--white-muted)" }}>Coming next.</p>
    </div>
  ),
});
