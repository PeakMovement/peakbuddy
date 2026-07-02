import { log } from "@/lib/log";
import { savePushToken } from "@/lib/push.functions";

declare global {
  interface Window {
    // Despia injects a global `despia()` bridge; commands are protocol strings.
    despia?: (command: string) => void;
  }
}

// Despia sets "despia" in the user agent when running inside the native runtime.
function isDespia(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.userAgent.toLowerCase().includes("despia");
}

function detectPlatform(): "ios" | "android" | "despia" | "web" {
  if (typeof window === "undefined") return "web";
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("despia")) return "despia";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "web";
}

export async function registerPushToken(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (!isDespia()) {
      log.info("Push bridge not available (not running in the native app)");
      return;
    }

    // Despia + OneSignal external_id model (docs: setup.despia.com): Despia
    // auto-registers the device with OneSignal at launch. We link that device to
    // our signed-in user via the despia() bridge with the setonesignalplayerid
    // command (?user_id=...). The backend then targets include_external_user_ids.
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;

    const platform = detectPlatform();
    const cmd = `setonesignalplayerid://?user_id=${encodeURIComponent(uid)}`;
    if (typeof window.despia === "function") {
      window.despia(cmd);
    } else {
      window.location.href = cmd;
    }

    // Lightweight registration marker so status UIs know the device is linked.
    await savePushToken({
      data: { token: `external:${uid}`, platform: platform === "web" ? "despia" : platform },
    }).catch(() => {});
  } catch (e) {
    log.error("registerPushToken failed", e);
  }
}
