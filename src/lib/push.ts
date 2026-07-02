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
    if (!window.despia) {
      log.info("Push bridge not available (web preview)");
      return;
    }

    // Despia + OneSignal use the external_id model (docs: setup.despia.com):
    // Despia auto-registers the device with OneSignal at launch. We link that
    // device to our signed-in user by invoking the setonesignalplayerid:// scheme
    // with the user id. The backend then targets include_external_user_ids.
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;

    const platform = detectPlatform();
    window.location.href = `setonesignalplayerid://${uid}`;

    // Lightweight registration marker so status UIs know the device is linked.
    await savePushToken({
      data: { token: `external:${uid}`, platform: platform === "web" ? "despia" : platform },
    }).catch(() => {});
  } catch (e) {
    log.error("registerPushToken failed", e);
  }
}
