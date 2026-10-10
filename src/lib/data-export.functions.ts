import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * A copy of the personal information Buddy holds for the signed-in patient.
 * The user id comes from the bearer token. Practitioners do not receive other
 * people's records from this function.
 */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: clients, error } = await supabaseAdmin
      .from("clients")
      .select(
        "id, full_name, email, phone, primary_complaint, created_at, popia_accepted_at, yves_ai_consent, yves_ai_consent_at",
      )
      .eq("auth_user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    const rows = clients ?? [];
    if (rows.length === 0) {
      return { ok: true as const, export: { clients: [], checkIns: [], consents: [], whatsapp: [] } };
    }

    const ids = rows.map((c) => c.id);
    const [{ data: checkIns }, { data: consents }, { data: whatsapp }] = await Promise.all([
      supabaseAdmin
        .from("check_ins")
        .select(
          "id, client_id, created_at, pain_level, sleep_quality, energy_level, mood, notes, flagged, source",
        )
        .in("client_id", ids)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("consent_records")
        .select(
          "id, client_id, consent_type, version, wording_snapshot, channel, accepted_at, withdrawn_at",
        )
        .in("client_id", ids)
        .order("accepted_at", { ascending: true }),
      supabaseAdmin
        .from("whatsapp_inbound")
        .select("id, client_id, received_at, kind, body")
        .in("client_id", ids)
        .order("received_at", { ascending: true }),
    ]);

    return {
      ok: true as const,
      export: {
        generatedAt: new Date().toISOString(),
        clients: rows,
        checkIns: checkIns ?? [],
        consents: consents ?? [],
        whatsapp: whatsapp ?? [],
      },
    };
  });
