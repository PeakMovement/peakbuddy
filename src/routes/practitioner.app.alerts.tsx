import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Alert, Client } from "@/lib/types";

export const Route = createFileRoute("/practitioner/app/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Buddy" }] }),
  component: Alerts,
});

type Filter = "all" | "unread" | "red_flag";

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function urgencyStyle(u: string): React.CSSProperties {
  switch (u) {
    case "emergency":
      return { background: "var(--red)", color: "var(--white)", border: "1px solid var(--red)" };
    case "urgent":
      return { background: "transparent", color: "var(--red)", border: "1px solid var(--red)" };
    case "soon":
      return { background: "transparent", color: "var(--amber)", border: "1px solid var(--amber)" };
    case "monitor":
      return { background: "transparent", color: "var(--blue-cold)", border: "1px solid var(--blue-cold)" };
    default:
      return { background: "transparent", color: "var(--white-muted)", border: "1px solid var(--navy-border)" };
  }
}

function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: a }, { data: c }] = await Promise.all([
      supabase
        .from("alerts")
        .select("*")
        .eq("practitioner_id", u.user.id)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("*").eq("practitioner_id", u.user.id),
    ]);
    setAlerts((a as Alert[]) ?? []);
    const map: Record<string, Client> = {};
    ((c as Client[]) ?? []).forEach((cl) => (map[cl.id] = cl));
    setClients(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => {
      if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    if (filter === "unread") return sorted.filter((a) => !a.is_read);
    if (filter === "red_flag") return sorted.filter((a) => a.urgency === "emergency" || a.urgency === "urgent");
    return sorted;
  }, [alerts, filter]);

  const markResolved = async (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    await supabase.from("alerts").update({ is_read: true }).eq("id", id);
  };

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>Alerts</h1>

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {(["all", "unread", "red_flag"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: filter === f ? "var(--blue-accent)" : "transparent",
              color: filter === f ? "var(--white)" : "var(--white-muted)",
              border: `1px solid ${filter === f ? "var(--blue-accent)" : "var(--navy-border)"}`,
              textTransform: "capitalize",
            }}
          >
            {f === "red_flag" ? "Red Flag" : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ marginTop: 24, color: "var(--white-muted)" }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            padding: 24,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 12,
            color: "var(--white-muted)",
            textAlign: "center",
          }}
        >
          No alerts. Your clients are all clear.
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((a) => {
            const client = clients[a.client_id];
            return (
              <div
                key={a.id}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 12,
                  padding: 14,
                  opacity: a.is_read ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)" }}>
                      {client?.full_name ?? "Unknown client"}
                    </div>
                    <div style={{ marginTop: 4, color: "var(--white-muted)", fontSize: 13 }}>{a.message}</div>
                  </div>
                  <span
                    style={{
                      ...urgencyStyle(a.urgency),
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {a.urgency}
                  </span>
                </div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                    {timeAgo(a.created_at)} ago
                  </span>
                  {!a.is_read && (
                    <button
                      type="button"
                      onClick={() => markResolved(a.id)}
                      style={{
                        background: "transparent",
                        color: "var(--blue-accent)",
                        border: "1px solid var(--blue-accent)",
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Mark resolved
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
