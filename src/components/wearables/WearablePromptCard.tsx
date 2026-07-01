// Subtle prompt on the check-in screen for clients who haven't linked a wearable yet.
// Dismissible (persists in localStorage). Self-contained data fetch.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Watch, X, ChevronRight } from "lucide-react";
import {
  getWearableConnections,
  type ConnectionStatus,
} from "@/lib/wearables/connect.functions";

const DISMISS_KEY = "wearable-prompt-dismissed-v1";

export function WearablePromptCard() {
  const loadConnections = useServerFn(getWearableConnections);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    let cancelled = false;
    loadConnections()
      .then((conns: ConnectionStatus[]) => {
        if (cancelled) return;
        const anyLinked = conns.some((c) => c.connected || c.status === "token_expired");
        if (!anyLinked) setShow(true);
      })
      .catch(() => {
        /* stay hidden on failure — never nag on error */
      });
    return () => {
      cancelled = true;
    };
  }, [loadConnections]);

  if (!show) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") window.localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  };

  return (
    <div
      style={{
        marginTop: 12,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "rgba(74,141,240,0.06)",
        border: "1px solid rgba(74,141,240,0.28)",
        borderRadius: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "rgba(74,141,240,0.12)",
          border: "1px solid rgba(74,141,240,0.35)",
          color: "var(--blue-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Watch size={16} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--blue-accent)",
            fontWeight: 700,
          }}
        >
          Optional
        </div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13.5,
            color: "var(--white)",
            marginTop: 1,
            lineHeight: 1.35,
          }}
        >
          Connect your smartwatch to auto-track sleep, HRV and activity.
        </div>
      </div>

      <Link
        to="/client/app/profile"
        hash="wearables"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "7px 10px",
          borderRadius: 8,
          background: "var(--blue-accent)",
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        Connect
        <ChevronRight size={12} />
      </Link>

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--white-muted)",
          cursor: "pointer",
          padding: 4,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
