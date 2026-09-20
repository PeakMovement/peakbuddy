import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Master AI feature gate.
 *
 * Cascade: platform_settings.programs_feature_enabled (global kill switch)
 *          AND practices.ai_features_enabled (per-practitioner toggle, set by super admin).
 *
 * When false, all AI features are blocked for the practice: Yves (Anthropic),
 * program suggestions (Google), morning analysis, nightly risk analysis, insights.
 */
export async function isPracticeAiEnabledFor(
  practiceId: string | null | undefined,
  practitionerId: string | null | undefined,
): Promise<boolean> {
  if (!practiceId && !practitionerId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Global kill switch
  const { data: platform } = await supabaseAdmin
    .from("platform_settings")
    .select("programs_feature_enabled")
    .limit(1)
    .maybeSingle();
  if (platform && platform.programs_feature_enabled === false) return false;

  // Per-practice flag
  let q = supabaseAdmin.from("practices").select("ai_features_enabled");
  q = practiceId ? q.eq("id", practiceId) : q.eq("practitioner_id", practitionerId!);
  const { data: practice } = await q.maybeSingle();
  if (!practice) return false;
  return practice.ai_features_enabled !== false;
}

/** Server function: returns whether AI features are enabled for the given client's practice. */
export const getClientAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { callerMayAccessClient } = await import("@/lib/practice-members.functions");
    const allowed = await callerMayAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!allowed) return { enabled: false };
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("practitioner_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) return { enabled: false };
    const enabled = await isPracticeAiEnabledFor(null, client.practitioner_id);
    return { enabled };
  });

/** Server function: AI features for the calling practitioner's own practice. */
export const getPractitionerAiEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") return {};
    const practitionerId = (input as { practitionerId?: unknown }).practitionerId;
    return typeof practitionerId === "string" ? { practitionerId } : {};
  })
  .handler(async ({ data, context }) => {
    // Ignore a spoofed practitionerId unless it is the caller.
    if (data?.practitionerId && data.practitionerId !== context.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if ((prof as { role?: string } | null)?.role !== "super_admin") {
        return { enabled: false };
      }
      const enabled = await isPracticeAiEnabledFor(null, data.practitionerId);
      return { enabled };
    }
    const enabled = await isPracticeAiEnabledFor(null, context.userId);
    return { enabled };
  });
