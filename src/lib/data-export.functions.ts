import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A copy of the personal information Buddy holds for the signed-in patient.
 * The user id comes from the bearer token. Practitioners do not receive other
 * people's records from this function. Heidi notes are not included.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadExportBundle } = await import("@/lib/whatsapp/data-copy.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const userId = context.userId;

    const { data: clients, error } = await admin
      .from("clients")
      .select("id")
      .eq("auth_user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    const ids = ((clients ?? []) as Array<{ id: string }>).map((c) => c.id);
    const bundle = await loadExportBundle(admin, ids);
    return { ok: true as const, export: bundle };
  });
