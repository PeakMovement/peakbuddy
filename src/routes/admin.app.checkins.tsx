import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminCheckinStatus } from "@/lib/checkin-status.functions";
import type { DeliverySummary } from "@/lib/whatsapp/checkin-delivery";

export const Route = createFileRoute("/admin/app/checkins")({
  head: () => ({ meta: [{ title: "Check-ins — Buddy Admin" }] }),
  component: CheckinStatusPage,
});

const WORD: Record<string, string> = {
  sent: "Sent",
  failed: "Failed",
  window_closed: "Window closed",
  waiting: "Not sent yet",
  not_due: "Later today",
};

function CheckinStatusPage() {
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminCheckinStatus()
      .then(setSummary)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load check-ins"));
  }, []);

  return (
    <div style={{ padding: 20, color: "var(--white)" }}>
      <h1 style={{ fontSize: 28, margin: "8px 0 4px" }}>Check-ins</h1>
      <p style={{ color: "var(--white-muted)", marginTop: 0 }}>
        Who was due a check-in today, and whether WhatsApp delivered it.
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {!summary && !error && <p style={{ color: "var(--white-muted)" }}>Loading…</p>}
      {summary && (
        <>
          <p>
            {summary.date}: {summary.due} due, {summary.sent} sent, {summary.failed} failed,{" "}
            {summary.windowClosed} window closed, {summary.replied} replied.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {summary.rows.map((row) => (
              <div
                key={`${row.name}-${row.when}`}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <strong>{row.name}</strong>
                <div style={{ color: "var(--white-muted)", fontSize: 14 }}>
                  {WORD[row.outcome] ?? row.outcome}
                  {row.replied ? " · replied" : ""} · {row.when}
                </div>
              </div>
            ))}
            {summary.rows.length === 0 && (
              <p style={{ color: "var(--white-muted)" }}>Nobody is due a check-in today.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
