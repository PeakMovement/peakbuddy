import { useEffect, useState } from "react";
import { getMyPushTokens } from "@/lib/push.functions";

type TokenRow = { id: string; platform: string | null; last_seen: string | null };

/** Read-only "is push wired up?" panel for the client profile screen. */
export function MyNotificationStatus() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [bridge, setBridge] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBridge((window as unknown as { despia?: unknown }).despia ? "yes" : "no");
    }
    void getMyPushTokens().then((r) => setTokens(r.tokens as TokenRow[]));
  }, []);

  return (
    <div
      style={{
        marginTop: 16,
        padding: 14,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          color: "var(--white)",
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 6,
        }}
      >
        Notifications
      </div>
      <Row label="Despia bridge" value={bridge === null ? "…" : bridge === "yes" ? "available" : "not in app (web preview)"} />
      <Row label="Registered devices" value={tokens === null ? "…" : `${tokens.length}`} />
      {tokens && tokens.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none" }}>
          {tokens.map((t) => (
            <li
              key={t.id}
              style={{
                color: "var(--white-muted)",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
                marginTop: 2,
              }}
            >
              {t.platform ?? "unknown"} · last seen{" "}
              {t.last_seen ? new Date(t.last_seen).toLocaleString() : "—"}
            </li>
          ))}
        </ul>
      )}
      {bridge === "no" && (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--white-muted)" }}>
          Open Buddy from the iPhone/Android app to register for push.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        color: "var(--white-muted)",
        fontFamily: "var(--font-ui)",
        marginTop: 2,
      }}
    >
      <span>{label}</span>
      <span style={{ color: "var(--white)" }}>{value}</span>
    </div>
  );
}
