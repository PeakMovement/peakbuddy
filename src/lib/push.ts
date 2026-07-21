import despia from "despia-native";
import { log } from "@/lib/log";
import { savePushToken } from "@/lib/push.functions";
import { subscribeWebPush, getWebSubscriptionId } from "@/lib/onesignal-web";

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

/**
 * Web/PWA push: opt in via the OneSignal Web SDK and store the subscription id
 * (targetable by include_player_ids, same as the native player id). No-op in
 * the Despia native app, which uses the bridge above.
 */
/**
 * Non-prompting web token capture. Saves the OneSignal subscription id ONLY if
 * the user has ALREADY opted in — it never triggers the permission prompt. Used
 * on app load so new clients are not shown an unsolicited notification dropdown;
 * the explicit "Enable notifications" button does the actual ask.
 */
export async function captureWebPushToken(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || isDespia()) return false;
    // Never triggers a prompt: only runs for users who already granted permission.
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const id = await getWebSubscriptionId();
    if (!id) return false;
    await savePushToken({ data: { token: id, platform: "web" } }).catch(() => {});
    return true;
  } catch (e) {
    log.error("captureWebPushToken failed", e);
    return false;
  }
}

export async function registerWebPushToken(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || isDespia()) return false;
    let id = await getWebSubscriptionId();
    if (!id) id = await subscribeWebPush();
    if (!id) return false;
    await savePushToken({ data: { token: id, platform: "web" } }).catch(() => {});
    return true;
  } catch (e) {
    log.error("registerWebPushToken failed", e);
    return false;
  }
}
