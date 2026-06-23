import { log } from "@/lib/log";
import { savePushToken } from "@/lib/push.functions";

type DespiaBridge = {
  requestPushToken?: () => Promise<string | null | undefined>;
};

declare global {
  interface Window {
    despia?: DespiaBridge;
  }
}

function detectPlatform(): "ios" | "android" | "despia" | "web" {
  if (typeof window === "undefined") return "web";
  if (window.despia) return "despia";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

export async function registerPushToken(): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    const bridge = window.despia;
    if (!bridge || typeof bridge.requestPushToken !== "function") {
      log.info("Push bridge not available (web preview)");
      return;
    }

    // DESPIA_PUSH_REGISTER: replace with Despia's documented bridge call that requests
    // notification permission and returns a device token string.
    // e.g. const token = await window.despia?.requestPushToken();
    const token = await bridge.requestPushToken();
    if (!token) {
      log.info("Push bridge returned no token");
      return;
    }

    const platform = detectPlatform();
    await savePushToken({
      data: { token, platform: platform === "web" ? "despia" : platform },
    });
  } catch (e) {
    log.error("registerPushToken failed", e);
  }
}
