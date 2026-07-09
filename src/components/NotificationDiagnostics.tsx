import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Stethoscope, RefreshCw } from "lucide-react";
import { getDiagnostics, type PushDiagnostics } from "@/lib/onesignal-web";

// Live web-push diagnostic readout. Temporary aid while wiring up notifications
// on iOS/PWA — shows exactly where the subscription chain breaks.
export function NotificationDiagnostics() {
  const [d, setD] = useState<PushDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setD(await getDiagnostics());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const rows: [string, string, boolean][] = d
    ? [
        ["Running as installed app", d.standaloneDisplay ? "yes" : "no (browser tab)", d.standaloneDisplay],
        ["Notification permission", d.permission, d.permission === "granted"],
        ["Service worker", d.serviceWorker, d.serviceWorker === "active"],
        ["OneSignal ready", d.oneSignalReady ? "yes" : "no", d.oneSignalReady],
        ["Subscribed (opted in)", d.optedIn === null ? "unknown" : d.optedIn ? "yes" : "no", d.optedIn === true],
        ["Subscription ID", d.subscriptionId ? `${d.subscriptionId.slice(0, 8)}…` : "none", Boolean(d.subscriptionId)],
      ]
    : [];

  return (
    <div style={card}>
      <div style={head}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Stethoscope size={16} color="var(--blue-accent)" aria-hidden />
          <span style={title}>Notification diagnostics</span>
        </div>
        <button type="button" onClick={refresh} disabled={busy} style={refreshBtn} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      {rows.map(([label, val, ok]) => (
        <div key={label} style={row}>
          <span style={{ color: "var(--white-muted)", fontSize: 12.5 }}>{label}</span>
          <span style={{ color: ok ? "var(--green)" : "var(--red)", fontFamily: "var(--font-data)", fontSize: 12.5 }}>
            {val}
          </span>
        </div>
      ))}
      {d?.swError && (
        <p style={{ ...hint, color: "var(--red)" }}>Service worker error: {d.swError}</p>
      )}
      {d?.swTestSameOrigin && (
        <p style={{ ...hint, color: d.swTestSameOrigin.startsWith("fail") ? "var(--red)" : "var(--green)" }}>
          Same-origin worker test: {d.swTestSameOrigin}
        </p>
      )}
      <p style={hint}>
        For notifications to work: installed app = yes, permission = granted, service worker = active,
        opted in = yes, and a Subscription ID present.
      </p>
    </div>
  );
}

const card: CSSProperties = {
  marginTop: 12,
  padding: 14,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
};
const head: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 };
const title: CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 600, color: "var(--white)", fontSize: 14 };
const refreshBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  color: "var(--white-muted)",
  padding: 6,
  cursor: "pointer",
};
const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "5px 0",
  borderTop: "1px solid rgba(255,255,255,0.05)",
};
const hint: CSSProperties = { color: "var(--white-muted)", fontSize: 11, lineHeight: 1.5, marginTop: 10, marginBottom: 0 };
