import despia from "despia-native";
import { log } from "@/lib/log";
import { savePushToken } from "@/lib/push.functions";

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

    // Step 5 (Despia guide): fetch the device's OneSignal Player ID via the
    // despia-native bridge and store it against the signed-in user, so the
    // backend can target this device with include_player_ids.
    let playerId: string | null = null;
    try {
      const data = (await despia("getonesignalplayerid://", ["onesignalplayerid"])) as
        | Record<string, unknown>
        | undefined;
      if (data && typeof data.onesignalplayerid === "string") playerId = data.onesignalplayerid;
    } catch {
      /* fall through to direct property access */
    }
    if (!playerId) {
      const direct = (despia as unknown as { onesignalplayerid?: string }).onesignalplayerid;
      if (typeof direct === "string" && direct) playerId = direct;
    }
    if (!playerId) {
      log.info("No OneSignal player id available from Despia yet");
      return;
    }

    const platform = detectPlatform();
    await savePushToken({
      data: { token: playerId, platform: platform === "web" ? "despia" : platform },
    }).catch(() => {});
  } catch (e) {
    log.error("registerPushToken failed", e);
  }
}
