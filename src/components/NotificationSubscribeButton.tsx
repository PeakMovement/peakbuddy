import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";
import despia from "despia-native";
import { registerPushToken, registerWebPushToken } from "@/lib/push";
import { getMyPushTokens } from "@/lib/push.functions";
import { webPushSupported } from "@/lib/onesignal-web";

// Native detection by user agent (Despia sets "despia" in the UA in the app).
function inNativeApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.toLowerCase().includes("despia");
}

/** Subscribe-to-notifications button for client + practitioner profiles. */
export function NotificationSubscribeButton() {
  const [tokens, setTokens] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const native = inNativeApp();

  const refresh = async () => {
    try {
      const r = await getMyPushTokens();
      setTokens(r?.tokens?.length ?? 0);
    } catch {
      setTokens(0);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const subscribe = async () => {
    if (!native) {
      // Web / installed-PWA path via the OneSignal Web SDK.
      if (!webPushSupported()) {
        setNote("Your browser doesn\u2019t support notifications. On iPhone, add Buddy to your Home Screen first.");
        return;
      }
      setBusy(true);
      setNote(null);
      try {
        const ok = await registerWebPushToken();
        await refresh();
        setNote(
          ok
            ? "You\u2019re subscribed to notifications."
            : "Tap Allow on the notification prompt to turn them on.",
        );
      } catch {
        setNote("Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      // Ask iOS/Android for permission (no-op if already granted).
      try {
        despia("registerpush://");
      } catch {
        /* ignore */
      }
      // Give the SDK a moment, then capture + store the OneSignal player id.
      await new Promise((r) => setTimeout(r, 2000));
      await registerPushToken();
      await refresh();
      const r = await getMyPushTokens();
      setNote(
        (r?.tokens?.length ?? 0) > 0
          ? "You're subscribed to notifications."
          : "Tap Allow on the notifications prompt, then tap the button again.",
      );
    } catch {
      setNote("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const on = (tokens ?? 0) > 0;

  return (
    <div style={card}>
      <div style={titleRow}>
        <BellRing size={17} color="var(--blue-accent)" aria-hidden />
        <span style={title}>Notifications</span>
      </div>
      <button type="button" onClick={subscribe} disabled={busy} style={on ? okBtn : primaryBtn}>
        {on ? (
          <>
            <Check size={16} /> Notifications on · re-check
          </>
        ) : (
          <>
            <BellRing size={16} /> {busy ? "Turning on…" : "Turn on notifications"}
          </>
        )}
      </button>
      {tokens !== null && (
        <div style={sub}>
          {tokens} device{tokens === 1 ? "" : "s"} registered
          {native ? "" : " · open the app on your phone to register"}
        </div>
      )}
      {note && <div style={noteS}>{note}</div>}
    </div>
  );
}

const card: CSSProperties = {
  marginTop: 16,
  padding: 16,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
};
const titleRow: CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 };
const title: CSSProperties = { fontFamily: "var(--font-ui)", color: "var(--white)", fontWeight: 700, fontSize: 15 };
const primaryBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  minHeight: 46,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const okBtn: CSSProperties = {
  ...primaryBtn,
  background: "transparent",
  color: "var(--green)",
  border: "1px solid var(--green)",
};
const sub: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "var(--white-muted)",
};
const noteS: CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  color: "var(--blue-accent)",
  lineHeight: 1.5,
};
