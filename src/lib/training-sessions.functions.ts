import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canAccessClient } from "@/lib/practice-members.functions";
import { TRAINING_SCHEDULE_CROSSCHECK } from "@/lib/feature-flags";
import {
  SESSION_TYPES,
  buildScheduleCrossCheck,
  type ScheduleCrossCheck,
  type SessionType,
  type TrainingSessionInput,
} from "@/lib/schedule-cross-check";
import { pickLoadMethod, loadForDay, type WearableDay } from "@/lib/load-metrics";

export type TrainingSession = {
  id: string;
  client_id: string;
  practitioner_id: string;
  practice_id: string | null;
  session_date: string;
  session_type: SessionType;
  title: string;
  intensity: number | null;
  duration_minutes: number | null;
  notes: string;
  source: "manual" | "wearable";
  created_at: string;
};

const SessionSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionType: z.enum(SESSION_TYPES),
  title: z.string().max(200).default(""),
  intensity: z.number().int().min(1).max(10).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable()
    .optional(),
  notes: z.string().max(2000).default(""),
});

function missingRelation(message: string | undefined): boolean {
  return /schema cache|does not exist|relation .* does not exist/i.test(message ?? "");
}

export const getTrainingScheduleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ enabled: boolean }> => {
    if (!TRAINING_SCHEDULE_CROSSCHECK) return { enabled: false };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("platform_settings")
        .select("training_schedule_enabled")
        .limit(1)
        .maybeSingle();
      const flag = (data as { training_schedule_enabled?: boolean } | null)
        ?.training_schedule_enabled;
      return { enabled: flag !== false };
    } catch {
      return { enabled: true };
    }
  });

export const listClientTrainingSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<TrainingSession[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");
    const { data: rows, error } = await supabaseAdmin
      .from("training_sessions")
      .select("*")
      .eq("client_id", data.clientId)
      .order("session_date", { ascending: false })
      .limit(200);
    if (error) {
      if (missingRelation(error.message)) return [];
      throw new Error(error.message);
    }
    return (rows ?? []) as TrainingSession[];
  });

export const upsertTrainingSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SessionSchema.parse(input))
  .handler(async ({ context, data }): Promise<TrainingSession> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id, practitioner_id, practice_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const payload = {
      client_id: data.clientId,
      practitioner_id: context.userId,
      practice_id: (client as { practice_id?: string | null }).practice_id ?? null,
      session_date: data.sessionDate,
      session_type: data.sessionType,
      title: data.title.trim(),
      intensity: data.intensity ?? null,
      duration_minutes: data.durationMinutes ?? null,
      notes: data.notes.trim(),
      source: "manual" as const,
      updated_at: new Date().toISOString(),
    };

    if (data.id) {
      const { data: row, error } = await supabaseAdmin
        .from("training_sessions")
        .update(payload)
        .eq("id", data.id)
        .eq("client_id", data.clientId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row as TrainingSession;
    }

    const { data: row, error } = await supabaseAdmin
      .from("training_sessions")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as TrainingSession;
  });

export const deleteTrainingSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");
    const { error } = await supabaseAdmin
      .from("training_sessions")
      .delete()
      .eq("id", data.id)
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type ScheduleOverlay = {
  enabled: boolean;
  sessions: TrainingSession[];
  crossCheck: ScheduleCrossCheck;
};

async function overlayForClient(clientId: string): Promise<ScheduleOverlay> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: sessions, error: sErr }, { data: checkIns }, { data: wear }] = await Promise.all([
    supabaseAdmin
      .from("training_sessions")
      .select("*")
      .eq("client_id", clientId)
      .order("session_date", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("check_ins")
      .select("created_at, pain_level, sleep_quality, stress_level, energy_level, flagged")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(400),
    supabaseAdmin
      .from("wearable_sessions")
      .select("date, training_load, active_calories, avg_heart_rate, duration_minutes")
      .eq("client_id", clientId)
      .order("date", { ascending: false })
      .limit(40),
  ]);
  const list = sErr && missingRelation(sErr.message) ? [] : ((sessions ?? []) as TrainingSession[]);
  const wearDays = (wear ?? []) as WearableDay[];
  const method = pickLoadMethod(wearDays);
  const wearable = wearDays.map((d) => ({
    date: d.date,
    load: method ? loadForDay(d, method) : null,
  }));
  const sessionInputs: TrainingSessionInput[] = list.map((s) => ({
    session_date: s.session_date,
    session_type: s.session_type,
    intensity: s.intensity,
    title: s.title,
  }));
  return {
    enabled: true,
    sessions: list,
    crossCheck: buildScheduleCrossCheck(sessionInputs, checkIns ?? [], wearable),
  };
}

export const getClientScheduleOverlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<ScheduleOverlay> => {
    if (!TRAINING_SCHEDULE_CROSSCHECK) {
      return {
        enabled: false,
        sessions: [],
        crossCheck: buildScheduleCrossCheck([], []),
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) throw new Error("Forbidden");
    try {
      const { data: settings } = await supabaseAdmin
        .from("platform_settings")
        .select("training_schedule_enabled")
        .limit(1)
        .maybeSingle();
      if (
        (settings as { training_schedule_enabled?: boolean } | null)?.training_schedule_enabled ===
        false
      ) {
        return { enabled: false, sessions: [], crossCheck: buildScheduleCrossCheck([], []) };
      }
    } catch {
      /* column may not exist yet */
    }
    return overlayForClient(data.clientId);
  });

/** Signed-in client: read-only overlay of their own schedule vs check-ins. */
export const getMyScheduleOverlay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ScheduleOverlay> => {
    if (!TRAINING_SCHEDULE_CROSSCHECK) {
      return { enabled: false, sessions: [], crossCheck: buildScheduleCrossCheck([], []) };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client)
      return { enabled: false, sessions: [], crossCheck: buildScheduleCrossCheck([], []) };
    return overlayForClient(client.id);
  });
