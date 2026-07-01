// Self-contained wearables panel: connect/disconnect a device + display synced data.
//
// Drop-in and movable — it owns all its own data loading and styling (inline styles
// using the app's CSS variables), so it can be placed on any client-app page with a
// single <WearablesPanel /> and relocated freely for a clean, minimal layout.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity, RefreshCw } from "lucide-react";
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

const PROVIDER_TAGLINE: Record<WearableProvider, string> = {
  oura: "Sleep, readiness & HRV telemetry.",
  polar: "Cardiovascular & training load telemetry.",
  garmin: "Activity, stress & recovery telemetry.",
};

// All three providers are wired end-to-end.
const LIVE_PROVIDERS: WearableProvider[] = ["oura", "polar", "garmin"];

const BLUE = "var(--blue-accent)";
const MUTED = "var(--white-muted)";
const WHITE = "var(--white)";
const CARD = "var(--navy-card)";
const BORDER = "var(--navy-border)";
const RED = "var(--red, #ef4444)";

function ProviderMark({ provider }: { provider: WearableProvider }) {
  const common = { width: 22, height: 22, fill: "currentColor" } as const;
  if (provider === "oura") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }
  if (provider === "polar") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M12 2 3 6v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6l-9-4Zm0 4.2 4.6 4.6L12 15.4 7.4 10.8 12 6.2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M12 2 3 20.3l.7.7L12 18l8.3 3 .7-.7L12 2Zm0 5.6 5.9 12L12 17l-5.9 2.6L12 7.6Z" />
    </svg>
  );
}

function relativeFrom(date: Date | null): string | null {
  if (!date) return null;
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}

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
  const [busyAction, setBusyAction] = useState<"connect" | "sync" | "disconnect" | null>(null);
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
        const label = PROVIDER_LABEL[provider as WearableProvider] ?? provider;
        if (status === "connected") {
          setMessage({ kind: "success", text: `${label} connected — syncing your data…` });
          setPostConnectPolling(true);
        } else if (status === "consent") {
          const hint =
            provider === "polar"
              ? "Open the Polar Flow app, grant AccessLink data permission, then tap Connect again."
              : provider === "garmin"
                ? "Open Garmin Connect → Settings → Connected Apps and enable data sharing for Buddy, then reconnect."
                : "Please grant data access in your device's app, then reconnect.";
          setMessage({ kind: "error", text: `${label}: ${hint}` });
        } else {
          setMessage({ kind: "error", text: `Couldn't connect ${label}. Please try again.` });
        }
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, [refresh]);

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

  const lastSyncByProvider = useMemo(() => {
    const map = new Map<string, Date>();
    for (const s of sessions) {
      const d = new Date(s.date);
      if (Number.isNaN(d.getTime())) continue;
      const prev = map.get(s.source);
      if (!prev || d > prev) map.set(s.source, d);
    }
    return map;
  }, [sessions]);

  const onConnect = async (provider: WearableProvider) => {
    setBusy(provider);
    setBusyAction("connect");
    try {
      const { authUrl } = await startConnect({ data: { provider } });
      window.location.href = authUrl;
    } catch {
      setMessage({ kind: "error", text: "Couldn't start the connection. Please try again." });
      setBusy(null);
      setBusyAction(null);
    }
  };

  const onDisconnect = async (provider: WearableProvider) => {
    setBusy(provider);
    setBusyAction("disconnect");
    try {
      await disconnect({ data: { provider } });
      await refresh();
    } finally {
      setBusy(null);
      setBusyAction(null);
    }
  };

  const onSync = async (provider: WearableProvider) => {
    setBusy(provider);
    setBusyAction("sync");
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
      setBusyAction(null);
    }
  };

  const latest = sessions.length ? sessions[sessions.length - 1] : null;
  const hasData = sessions.some(
    (s) =>
      s.sleep_score != null || s.resting_hr != null || s.hrv_avg != null || s.total_steps != null,
  );

  return (
    <section className={className} style={{ ...cardStyle, ...style }}>
      <header style={panelHeader}>
        <div>
          <h2 style={titleStyle}>Wearables Panel</h2>
          <p style={subtitleStyle}>Connect a device to track sleep, recovery and activity automatically.</p>
        </div>
        <span style={eyebrowStyle}>External Device Integration</span>
      </header>

      {message && (
        <div
          style={{
            ...noticeStyle,
            borderColor:
              message.kind === "error"
                ? "rgba(239,68,68,0.5)"
                : message.kind === "success"
                  ? "rgba(79,141,240,0.5)"
                  : BORDER,
            color: message.kind === "error" ? "var(--red-soft, #fecaca)" : WHITE,
          }}
        >
          {message.text}
        </div>
      )}

      <div style={gridStyle}>
        {(["oura", "polar", "garmin"] as WearableProvider[]).map((provider) => {
          const conn = connections.find((c) => c.provider === provider);
          const live = LIVE_PROVIDERS.includes(provider);
          const connected = conn?.connected ?? false;
          const expired = conn?.status === "token_expired";
          const isBusy = busy === provider;
          const lastSynced = relativeFrom(lastSyncByProvider.get(provider) ?? null);

          const tone: "connected" | "expired" | "muted" = connected
            ? "connected"
            : expired
              ? "expired"
              : "muted";
          const accent = tone === "connected" ? BLUE : tone === "expired" ? RED : MUTED;

          return (
            <article
              key={provider}
              style={{
                ...providerCard,
                borderColor:
                  tone === "connected"
                    ? "rgba(74,141,240,0.35)"
                    : tone === "expired"
                      ? "rgba(239,68,68,0.35)"
                      : BORDER,
              }}
            >
              <div style={cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: WHITE }}>
                  <span style={{ ...logoBadge, color: accent }}>
                    <ProviderMark provider={provider} />
                  </span>
                  <div>
                    <div style={brandNameStyle}>{PROVIDER_LABEL[provider]}</div>
                    <div style={taglineStyle}>{PROVIDER_TAGLINE[provider]}</div>
                  </div>
                </div>
                <StatusPill
                  tone={tone}
                  label={
                    isBusy && busyAction === "connect"
                      ? "Connecting"
                      : connected
                        ? "Connected"
                        : expired
                          ? "Auth error"
                          : "Not connected"
                  }
                />
              </div>

              <div style={cardBody}>
                {!live ? (
                  <p style={emptyTextStyle}>Coming soon — this provider isn't wired up yet.</p>
                ) : connected ? (
                  <>
                    <div style={metaRowStyle}>
                      <span style={metaLabelStyle}>Last sync</span>
                      <span style={metaValueStyle}>{lastSynced ?? "Awaiting first sync"}</span>
                    </div>
                    {isBusy && busyAction === "sync" && (
                      <div style={{ ...syncingRow, color: BLUE }}>
                        <RefreshCw size={12} className="anim-spin" />
                        <span>Syncing biometrics…</span>
                      </div>
                    )}
                  </>
                ) : expired ? (
                  <p style={{ ...emptyTextStyle, color: "var(--red-soft, #fecaca)" }}>
                    Provider credentials have expired. Reconnect to resume the data feed.
                  </p>
                ) : (
                  <p style={emptyTextStyle}>
                    No telemetry detected yet. Connect your {PROVIDER_LABEL[provider]} to begin.
                  </p>
                )}
              </div>

              <div style={cardFooter}>
                {!live ? (
                  <span style={mutedTagStyle}>Coming soon</span>
                ) : connected ? (
                  <>
                    <button
                      style={syncBtn}
                      disabled={isBusy}
                      onClick={() => onSync(provider)}
                    >
                      <RefreshCw
                        size={12}
                        className={isBusy && busyAction === "sync" ? "anim-spin" : undefined}
                        style={{ marginRight: 6, verticalAlign: "-1px" }}
                      />
                      {isBusy && busyAction === "sync" ? "Syncing" : "Sync now"}
                    </button>
                    <button
                      style={ghostBtn}
                      disabled={isBusy}
                      onClick={() => onDisconnect(provider)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : expired ? (
                  <button
                    style={{ ...primaryBtn, background: "rgba(239,68,68,0.12)", color: "var(--red-soft, #fecaca)", border: "1px solid rgba(239,68,68,0.5)" }}
                    disabled={isBusy}
                    onClick={() => onConnect(provider)}
                  >
                    {isBusy ? "Opening…" : "Reconnect"}
                  </button>
                ) : (
                  <button
                    style={primaryBtn}
                    disabled={isBusy}
                    onClick={() => onConnect(provider)}
                  >
                    {isBusy ? "Opening…" : "Connect device"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Latest metrics */}
      {!loading && hasData && latest && (
        <div style={{ marginTop: 18 }}>
          <div style={sectionEyebrow}>Latest telemetry</div>
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
                <Line type="monotone" dataKey="sleep_score" name="Sleep" stroke="var(--blue-accent)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="hrv_avg" name="HRV" stroke="var(--green)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading && connections.some((c) => c.connected) && !hasData && (
        <div style={{ ...noticeStyle, marginTop: 14 }}>
          <Activity size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Connected — your data will appear shortly after the first sync.
        </div>
      )}

      <style>{`@keyframes wp-spin { to { transform: rotate(360deg); } } .anim-spin { animation: wp-spin 1s linear infinite; }`}</style>
    </section>
  );
}

function StatusPill({ tone, label }: { tone: "connected" | "expired" | "muted"; label: string }) {
  const color = tone === "connected" ? BLUE : tone === "expired" ? RED : MUTED;
  const borderColor =
    tone === "connected"
      ? "rgba(74,141,240,0.4)"
      : tone === "expired"
        ? "rgba(239,68,68,0.4)"
        : BORDER;
  const bg =
    tone === "connected"
      ? "rgba(74,141,240,0.1)"
      : tone === "expired"
        ? "rgba(239,68,68,0.1)"
        : "rgba(255,255,255,0.04)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-ui)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 999,
        padding: "3px 9px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          boxShadow: tone === "connected" ? `0 0 6px ${color}` : "none",
          animation: tone === "connected" ? "wp-spin 0s" : undefined,
        }}
      />
      {label}
    </span>
  );
}

function Metric({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div style={metricCell}>
      <div style={{ fontFamily: "var(--font-data)", fontSize: 20, fontWeight: 700, color: WHITE }}>
        {value == null ? "—" : Math.round(value * 10) / 10}
        {value != null && unit ? (
          <span style={{ fontSize: 11, color: MUTED }}> {unit}</span>
        ) : null}
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
    </div>
  );
}

// ---- styles ----
const cardStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  padding: 18,
};
const panelHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 12,
  paddingBottom: 12,
  marginBottom: 14,
  borderBottom: `1px solid ${BORDER}`,
  flexWrap: "wrap",
};
const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontSize: 26,
  fontStyle: "italic",
  fontWeight: 600,
  color: WHITE,
  margin: 0,
  lineHeight: 1.1,
};
const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: MUTED,
  margin: "4px 0 0",
};
const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.22em",
  fontWeight: 600,
};
const sectionEyebrow: React.CSSProperties = {
  ...eyebrowStyle,
  marginBottom: 8,
};
const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 12,
};
const providerCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 180,
  transition: "border-color 150ms ease, background 150ms ease",
};
const cardHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
};
const logoBadge: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${BORDER}`,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const brandNameStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  fontWeight: 700,
  color: WHITE,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};
const taglineStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  color: MUTED,
  marginTop: 1,
};
const cardBody: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const metaRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontFamily: "var(--font-ui)",
};
const metaLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontWeight: 600,
};
const metaValueStyle: React.CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 13,
  color: WHITE,
};
const syncingRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-ui)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  fontWeight: 700,
  marginTop: 4,
};
const emptyTextStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: MUTED,
  margin: 0,
  lineHeight: 1.45,
  fontStyle: "italic",
};
const cardFooter: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 4,
};
const primaryBtn: React.CSSProperties = {
  flex: 1,
  background: BLUE,
  color: WHITE,
  border: "none",
  borderRadius: 8,
  padding: "9px 12px",
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
  boxShadow: "0 0 15px rgba(74,141,240,0.2)",
};
const syncBtn: React.CSSProperties = {
  flex: 1,
  background: "rgba(74,141,240,0.1)",
  color: BLUE,
  border: `1px solid rgba(74,141,240,0.4)`,
  borderRadius: 8,
  padding: "9px 12px",
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: MUTED,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "9px 12px",
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  cursor: "pointer",
};
const mutedTagStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  color: MUTED,
  border: `1px solid ${BORDER}`,
  borderRadius: 999,
  padding: "5px 12px",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};
const noticeStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: WHITE,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 12,
};
const metricGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
  gap: 8,
};
const metricCell: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: "10px 8px",
  textAlign: "center",
};
