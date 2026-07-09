import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  startGoogleCalendarConnect,
  type GoogleCalendarStatus,
} from "@/lib/google-calendar.functions";

export function GoogleCalendarConnectCard() {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useServerFn(getGoogleCalendarStatus);
  const start = useServerFn(startGoogleCalendarConnect);
  const disconnect = useServerFn(disconnectGoogleCalendar);

  useEffect(() => {
    load().then(setStatus).catch((e: Error) => setError(e.message));
  }, [load]);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { authUrl } = await start({
        data: { redirectAfter: window.location.pathname },
      });
      window.location.href = authUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnect();
      setStatus({ connected: false, email: null, scope: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "var(--white)", fontWeight: 600, fontSize: 15 }}>
            Google Calendar
          </div>
          <div style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 2 }}>
            {status?.connected
              ? `Connected${status.email ? ` as ${status.email}` : ""}`
              : "Not connected"}
          </div>
        </div>
        {status?.connected ? (
          <button
            onClick={onDisconnect}
            disabled={busy}
            style={btn("transparent", "var(--white-muted)", "1px solid var(--navy-border)")}
          >
            {busy ? "…" : "Disconnect"}
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={busy || !status}
            style={btn("var(--blue-accent)", "var(--white)", "none")}
          >
            {busy ? "…" : "Connect"}
          </button>
        )}
      </div>
      {error && <div style={{ color: "var(--red)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function btn(bg: string, color: string, border: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border,
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 36,
  };
}
