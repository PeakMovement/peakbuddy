// Self-contained wearables panel: connect/disconnect a device + display synced data.
//
// Drop-in and movable — it owns all its own data loading and styling (inline styles
// using the app's CSS variables), so it can be placed on any client-app page with a
// single <WearablesPanel /> and relocated freely for a clean, minimal layout.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, RefreshCw, Watch } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/lib/supabase";
import { getClientId } from "@/lib/client-session";
import {
  connectWearable,
  disconnectWearable,
  getWearableConnections,
  type ConnectionStatus,
  type WearableProvider,
} from "@/lib/wearables/connect.functions";
import { syncWearable } from "@/lib/wearables/sync.functions";

type Session = {
  date: string;
  source: string;
  sleep_score: number | null;
  readiness_score: number | null;
  activity_score: number | null;
  resting_hr: number | null;
  hrv_avg: number | null;
  total_steps: number | null;
  total_sleep_duration: number | null;
};

const PROVIDER_LABEL: Record<WearableProvider, string> = {
  oura: "Oura Ring",
  polar: "Polar",
  garmin: "Garmin",
};

// All three providers are wired end-to-end.
const LIVE_PROVIDERS: WearableProvider[] = ["oura", "polar", "garmin"];

export function WearablesPanel({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const loadConnections = useServerFn(getWearableConnections);
  const startConnect = useServerFn(connectWearable);
  const disconnect = useServerFn(disconnectWearable);
  const runSync = useServerFn(syncWearable);

  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<WearableProvider | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "success" | "error"; text: string } | null>(null);
  const [postConnectPolling, setPostConnectPolling] = useState(false);

  const refresh = useCallback(async () => {
    const clientId = getClientId();
    if (!clientId) return;
    const [conns, { data }] = await Promise.all([
      loadConnections().catch(() => [] as ConnectionStatus[]),
      supabase
        .from("wearable_sessions")
        .select(
          "date, source, sleep_score, readiness_score, activity_score, resting_hr, hrv_avg, total_steps, total_sleep_duration",
        )
        .eq("client_id", clientId)
        .order("date", { ascending: true })
        .limit(30),
    ]);
    setConnections(conns);
    setSessions((data ?? []) as Session[]);
    setLoading(false);
  }, [loadConnections]);

  useEffect(() => {
    refresh();
    // Surface the OAuth round-trip result, then clean the URL.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("status");
      const provider = params.get("wearable");
      if (provider && status) {
        if (status === "connected") {
          setMessage({ kind: "success", text: `${provider === "oura" ? "Oura Ring" : provider} connected — syncing your data…` });
          setPostConnectPolling(true);
        } else if (status === "consent") {
          setMessage({ kind: "error", text: "Please grant data access in your device's app, then reconnect." });
        } else {
          setMessage({ kind: "error", text: "Couldn't connect your device. Please try again." });
        }
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [refresh]);

  // After a successful OAuth return, poll for the first batch of session data
  // so the panel flips from "syncing…" to real numbers without a manual reload.
  useEffect(() => {
    if (!postConnectPolling) return;
    let cancelled = false;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      if (sessions.length > 0 || Date.now() - started > 45_000) {
        setPostConnectPolling(false);
        if (sessions.length > 0) setMessage({ kind: "success", text: "Your latest data is ready." });
        return;
      }
      setTimeout(tick, 3000);
    };
    const t = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postConnectPolling]);

  const onConnect = async (provider: WearableProvider) => {
    setBusy(provider);
    try {
      const { authUrl } = await startConnect({ data: { provider } });
      window.location.href = authUrl;
    } catch {
      setMessage({ kind: "error", text: "Couldn't start the connection. Please try again." });
      setBusy(null);
    }
  };

  const onDisconnect = async (provider: WearableProvider) => {
    setBusy(provider);
    try {
      await disconnect({ data: { provider } });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const onSync = async (provider: WearableProvider) => {
    setBusy(provider);
    try {
      const res = await runSync({ data: { provider } });
      if (res.ok) {
        setMessage({
          kind: "success",
          text:
            provider === "garmin"
              ? "Requested a sync — Garmin data appears shortly."
              : res.synced > 0
                ? `Synced ${res.synced} day(s).`
                : "Up to date.",
        });
        await refresh();
      } else {
        setMessage({
          kind: "error",
          text:
            res.error === "reconnect"
              ? "Connection expired — please reconnect."
              : res.error === "consent"
                ? "Please grant data access in your device's app."
                : "Sync failed.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const latest = sessions.length ? sessions[sessions.length - 1] : null;
  const hasData = sessions.some(
    (s) =>
      s.sleep_score != null || s.resting_hr != null || s.hrv_avg != null || s.total_steps != null,
  );

  return (
    <section className={className} style={{ ...cardStyle, ...style }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Watch size={18} color="var(--blue-accent)" />
        <h2 style={titleStyle}>Wearables</h2>
      </header>
      <p style={subtitleStyle}>
        Connect a device to track sleep, recovery and activity automatically.
      </p>

      {message && (
        <div
          style={{
            ...noticeStyle,
            borderColor:
              message.kind === "error"
                ? "rgba(239,68,68,0.5)"
                : message.kind === "success"
                  ? "rgba(34,197,94,0.5)"
                  : "var(--navy-border)",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Connection rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {(["oura", "polar", "garmin"] as WearableProvider[]).map((provider) => {
          const conn = connections.find((c) => c.provider === provider);
          const live = LIVE_PROVIDERS.includes(provider);
          const connected = conn?.connected ?? false;
          const expired = conn?.status === "token_expired";
          return (
            <div key={provider} style={rowStyle}>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 14,
                  color: "var(--white)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {PROVIDER_LABEL[provider]}
                {live && (
                  <StatusPill
                    tone={connected ? "success" : expired ? "warn" : "muted"}
                    label={
                      busy === provider
                        ? "…"
                        : connected
                          ? "Connected"
                          : expired
                            ? "Expired"
                            : "Not connected"
                    }
                  />
                )}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!live ? (
                  <span style={mutedTagStyle}>Coming soon</span>
                ) : connected ? (
                  <>
                    <button
                      style={ghostBtn}
                      disabled={busy === provider}
                      onClick={() => onSync(provider)}
                    >
                      <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                      {busy === provider ? "Syncing…" : "Sync"}
                    </button>
                    <button
                      style={ghostBtn}
                      disabled={busy === provider}
                      onClick={() => onDisconnect(provider)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    style={primaryBtn}
                    disabled={busy === provider}
                    onClick={() => onConnect(provider)}
                  >
                    {busy === provider ? "Connecting…" : expired ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Latest metrics */}
      {!loading && hasData && latest && (
        <div style={{ marginTop: 16 }}>
          <div style={metricGrid}>
            <Metric label="Sleep" value={latest.sleep_score} />
            <Metric label="Readiness" value={latest.readiness_score} />
            <Metric label="Resting HR" value={latest.resting_hr} unit="bpm" />
            <Metric label="HRV" value={latest.hrv_avg} unit="ms" />
            <Metric label="Steps" value={latest.total_steps} />
            <Metric
              label="Sleep time"
              value={
                latest.total_sleep_duration
                  ? Math.round((latest.total_sleep_duration / 3600) * 10) / 10
                  : null
              }
              unit="h"
            />
          </div>

          {/* 30-day trend */}
          <div style={{ height: 160, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sessions} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--white-muted)", fontSize: 10 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fill: "var(--white-muted)", fontSize: 10 }} width={28} />
                <Tooltip
                  contentStyle={{
                    background: "var(--navy-card)",
                    border: "1px solid var(--navy-border)",
                    borderRadius: 8,
                  }}
                  labelStyle={{ color: "var(--white-muted)" }}
                />
                <Line
                  type="monotone"
                  dataKey="sleep_score"
                  name="Sleep"
                  stroke="var(--blue-accent)"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="hrv_avg"
                  name="HRV"
                  stroke="var(--green)"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading && connections.some((c) => c.connected) && !hasData && (
        <div style={{ ...noticeStyle, marginTop: 12 }}>
          <Activity size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Connected — your data will appear shortly after the first sync.
        </div>
      )}
    </section>
  );
}

function StatusPill({ tone, label }: { tone: "success" | "warn" | "muted"; label: string }) {
  const color =
    tone === "success" ? "#22c55e" : tone === "warn" ? "#f59e0b" : "var(--white-muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-ui)",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${tone === "muted" ? "var(--navy-border)" : color}`,
        borderRadius: 999,
        padding: "2px 8px",
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function Metric({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div style={metricCell}>
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--white)",
        }}
      >
        {value == null ? "—" : Math.round(value * 10) / 10}
        {value != null && unit ? (
          <span style={{ fontSize: 11, color: "var(--white-muted)" }}> {unit}</span>
        ) : null}
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--white-muted)" }}>
        {label}
      </div>
    </div>
  );
}

// ---- styles (CSS variables from the app theme) ----
const cardStyle: React.CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 14,
  padding: 16,
};
const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 18,
  fontWeight: 600,
  color: "var(--white)",
  margin: 0,
};
const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "var(--white-muted)",
  margin: "2px 0 0",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 0",
  borderTop: "1px solid var(--navy-border)",
};
const primaryBtn: React.CSSProperties = {
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  padding: "6px 14px",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "6px 12px",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
const mutedTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "3px 10px",
};
const noticeStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "var(--white)",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "8px 10px",
  marginTop: 10,
};
const metricGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 8,
};
const metricCell: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "10px 8px",
  textAlign: "center",
};
