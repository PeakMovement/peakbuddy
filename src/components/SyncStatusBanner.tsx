import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CloudUpload, RefreshCw } from "lucide-react";
import { queueLength, flushQueue } from "@/lib/offline-queue";
import { useOnline } from "@/hooks/use-online";

/** Shows a clear status when check-ins are saved offline and waiting to sync. */
export function SyncStatusBanner() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const tick = () => setPending(queueLength());
    tick();
    const id = setInterval(tick, 4000);
    if (typeof window !== "undefined") window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      if (typeof window !== "undefined") window.removeEventListener("focus", tick);
    };
  }, []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await flushQueue();
    } finally {
      setSyncing(false);
      setPending(queueLength());
    }
  };

  if (pending <= 0) return null;

  return (
    <div style={bar} role="status" aria-live="polite">
      <CloudUpload size={15} aria-hidden />
      <span style={{ flex: 1 }}>
        {pending} check-in{pending === 1 ? "" : "s"} saved offline
        {online ? "" : " · will sync when you're back online"}
      </span>
      {online && (
        <button type="button" onClick={sync} disabled={syncing} style={btn} aria-label="Sync now">
          <RefreshCw size={13} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      )}
    </div>
  );
}

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  background: "rgba(74,141,240,0.14)",
  borderBottom: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
};
const btn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 999,
  padding: "5px 12px",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
