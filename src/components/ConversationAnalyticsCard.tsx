import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getConversationAnalytics } from "@/lib/conversation-layer.functions";
import type { ConvoStats } from "@/lib/whatsapp/convo-analytics";

function pct(value: number | null): string {
  if (value == null) return "No data yet";
  return `${Math.round(value * 100)}%`;
}

export function ConversationAnalyticsCard() {
  const load = useServerFn(getConversationAnalytics);
  const [stats, setStats] = useState<ConvoStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (!cancelled) setStats(r.stats);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const drop = stats?.dropoff[0];
  return (
    <section
      style={{
        marginTop: 24,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--white-muted)",
        }}
      >
        Conversation
      </div>
      {failed ? (
        <p style={{ color: "var(--white-muted)", fontSize: 14, marginTop: 8 }}>
          Conversation counts are not available yet.
        </p>
      ) : !stats ? (
        <p style={{ color: "var(--white-muted)", fontSize: 14, marginTop: 8 }}>Loading counts…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <Stat label="Understanding" value={pct(stats.understandingRate)} />
          <Stat label="Fallback" value={pct(stats.fallbackRate)} />
          <Stat
            label="Turns per check in"
            value={stats.avgTurnsPerSave == null ? "No data yet" : stats.avgTurnsPerSave.toFixed(1)}
          />
          <Stat label="Drop off" value={drop ? `${drop.field} (${drop.count})` : "None yet"} />
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--white-muted)", fontSize: 12, fontFamily: "var(--font-ui)" }}>{label}</div>
      <div style={{ color: "var(--white)", fontSize: 18, fontFamily: "var(--font-data)", marginTop: 4 }}>{value}</div>
    </div>
  );
}
