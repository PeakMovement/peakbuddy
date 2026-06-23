import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Patient feedback on a Yves reply.
 *
 * IMPORTANT: This data is for product UX and prompt iteration ONLY.
 * It MUST NEVER feed the calibration layer, alert severity, urgency,
 * thresholds, or any clinical decision. The patient's tap here is a
 * comprehension and helpfulness signal about the conversation, not a
 * downgrade of any clinical flag. Safety messaging and practitioner
 * alerts stand regardless of what the patient submits here.
 */
export const setPatientFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { symptomQueryId: string; understood?: boolean | null; helpful?: boolean | null }) =>
      z
        .object({
          symptomQueryId: z.string().uuid(),
          understood: z.boolean().nullable().optional(),
          helpful: z.boolean().nullable().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ownership: caller must be the client who owns this symptom_query.
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("symptom_queries")
      .select("id, client_id")
      .eq("id", data.symptomQueryId)
      .maybeSingle();
    if (rowErr || !row) return { ok: false as const, reason: "not_found" as const };

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, auth_user_id")
      .eq("id", row.client_id)
      .maybeSingle();
    if (!client || client.auth_user_id !== context.userId) {
      return { ok: false as const, reason: "forbidden" as const };
    }

    const patch: Record<string, unknown> = { patient_feedback_at: new Date().toISOString() };
    if (data.understood !== undefined) patch.patient_understood = data.understood;
    if (data.helpful !== undefined) patch.patient_helpful = data.helpful;

    const { error } = await supabaseAdmin
      .from("symptom_queries")
      .update(patch)
      .eq("id", row.id);
    if (error) throw error;
    return { ok: true as const };
  });
