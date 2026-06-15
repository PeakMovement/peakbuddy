import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProgramLite = {
  id: string;
  name: string;
  description: string;
  external_url: string;
  image_url: string | null;
  cover_image_url: string | null;
  duration_label: string | null;
  focus_area: string | null;
  outcomes: string[];
};

export type ProgramDecision = "accepted" | "declined" | "remind_later";

export type ClientProgramState = {
  client_id: string;
  program: ProgramLite | null;
  status: "none" | "pending" | "accepted" | "declined";
  decided_at: string | null;
  first_login: boolean;
  personal_note: string | null;
  snoozed_until: string | null;
};

const PROGRAM_COLS =
  "id, name, description, external_url, image_url, cover_image_url, duration_label, focus_area, outcomes";

const CLIENT_COLS =
  "id, suggested_program_id, program_status, program_decided_at, first_login_at, program_personal_note, program_reminder_snoozed_until";

// Public: is the Suggested Programs feature globally enabled? Defaults to true
// if no platform_settings row exists, preserving prior behavior.
export async function isProgramsFeatureEnabled(): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("platform_settings")
    .select("programs_feature_enabled")
    .limit(1)
    .maybeSingle();
  const row = data as { programs_feature_enabled?: boolean } | null;
  if (!row) return true;
  return row.programs_feature_enabled !== false;
}

export const getProgramsFeatureEnabled = createServerFn({ method: "GET" }).handler(
  async () => ({ enabled: await isProgramsFeatureEnabled() }),
);

// Public: list of admin-approved + active programs (id + name) for practitioner dropdown.
export const listActivePrograms = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await isProgramsFeatureEnabled())) return [] as { id: string; name: string }[];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("id, name")
    .eq("active", true)
    .eq("approved_by_admin", true)
    .order("priority", { ascending: false })
    .order("name", { ascending: true });
  if (error) return [] as { id: string; name: string }[];
  return (data ?? []) as { id: string; name: string }[];
});



type ClientRow = {
  id: string;
  suggested_program_id: string | null;
  program_status: "none" | "pending" | "accepted" | "declined";
  program_decided_at: string | null;
  first_login_at: string | null;
  program_personal_note: string | null;
  program_reminder_snoozed_until: string | null;
};

async function loadClientByAuth(email: string | null): Promise<ClientRow | null> {
  if (!email) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Defensive: if multiple rows somehow exist for an email, prefer the most recent one
  // with an assigned program, then fall back to the most recent row overall.
  const { data } = await supabaseAdmin
    .from("clients")
    .select(CLIENT_COLS + ", created_at")
    .ilike("email", email)
    .order("suggested_program_id", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return (row as ClientRow | null) ?? null;
}

async function loadProgram(id: string | null): Promise<ProgramLite | null> {
  if (!id) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("programs")
    .select(PROGRAM_COLS)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    external_url: String(row.external_url ?? ""),
    image_url: (row.image_url as string | null) ?? null,
    cover_image_url: (row.cover_image_url as string | null) ?? null,
    duration_label: (row.duration_label as string | null) ?? null,
    focus_area: (row.focus_area as string | null) ?? null,
    outcomes: Array.isArray(row.outcomes) ? (row.outcomes as string[]) : [],
  };
}

function buildState(client: ClientRow | null, program: ProgramLite | null, firstLogin: boolean): ClientProgramState {
  if (!client) {
    return {
      client_id: "",
      program: null,
      status: "none",
      decided_at: null,
      first_login: false,
      personal_note: null,
      snoozed_until: null,
    };
  }
  return {
    client_id: client.id,
    program,
    status: client.program_status,
    decided_at: client.program_decided_at,
    first_login: firstLogin,
    personal_note: client.program_personal_note,
    snoozed_until: client.program_reminder_snoozed_until,
  };
}

// Called by the client app on mount. Stamps first_login_at the first time and returns
// the assigned-program state so the intro modal can be shown.
export const getClientBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client) return buildState(null, null, false);

    const wasFirstLogin = client.first_login_at === null;
    if (wasFirstLogin) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("clients")
        .update({ first_login_at: new Date().toISOString() })
        .eq("id", client.id);
    }

    if (!(await isProgramsFeatureEnabled())) return buildState(client, null, wasFirstLogin);
    const program = await loadProgram(client.suggested_program_id);
    return buildState(client, program, wasFirstLogin);
  });

// Returns current program state without mutating first_login_at — for the profile page.
export const getMyProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client) return buildState(null, null, false);
    if (!(await isProgramsFeatureEnabled())) return buildState(client, null, false);
    const program = await loadProgram(client.suggested_program_id);
    return buildState(client, program, false);
  });


const RespondSchema = z.object({
  decision: z.enum(["accepted", "declined", "remind_later"]),
});

const SNOOZE_DAYS = 3;

export const respondToSuggestedProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RespondSchema.parse(input))
  .handler(async ({ data, context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client || !client.suggested_program_id) {
      return { ok: false as const, error: "No suggested program." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.decision === "remind_later") {
      const snoozeUntil = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabaseAdmin
        .from("clients")
        .update({
          program_status: "pending",
          program_reminder_snoozed_until: snoozeUntil,
        })
        .eq("id", client.id);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, status: "pending" as const, snoozed_until: snoozeUntil };
    }

    const status: "accepted" | "declined" = data.decision;
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        program_status: status,
        program_decided_at: new Date().toISOString(),
        program_reminder_snoozed_until: null,
      })
      .eq("id", client.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, status, snoozed_until: null };
  });

const PractClientSchema = z.object({ clientId: z.string().uuid() });

// Practitioner mirror — returns program + status for a client they own.
export const getClientProgramForPractitioner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PractClientSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await supabaseAdmin
      .from("clients")
      .select(`${CLIENT_COLS}, practitioner_id`)
      .eq("id", data.clientId)
      .maybeSingle();
    if (!c) return null;
    const row = c as ClientRow & { practitioner_id: string };
    const isOwner = row.practitioner_id === context.userId;
    let allowed = isOwner;
    if (!allowed) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      allowed = (prof as { role?: string } | null)?.role === "super_admin";
    }
    if (!allowed) return null;
    const program = await loadProgram(row.suggested_program_id);
    return {
      program,
      status: row.program_status,
      decided_at: row.program_decided_at,
      personal_note: row.program_personal_note,
    };
  });

// Practitioner: list of clients waiting for a program-suggestion decision.
export type PendingSuggestion = {
  client_id: string;
  client_name: string;
  primary_complaint: string | null;
  program: ProgramLite | null;
  source: "auto_rules" | "auto_ai" | "practitioner" | null;
  suggested_at: string | null;
};

export const listPendingProgramSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select(
        "id, full_name, primary_complaint, suggested_program_id, program_suggested_by, program_suggested_at",
      )
      .eq("practitioner_id", context.userId)
      .eq("program_status", "awaiting_practitioner")
      .order("program_suggested_at", { ascending: false });
    if (error || !data) return [] as PendingSuggestion[];

    const rows = data as Array<{
      id: string;
      full_name: string;
      primary_complaint: string | null;
      suggested_program_id: string | null;
      program_suggested_by: PendingSuggestion["source"];
      program_suggested_at: string | null;
    }>;

    const programs = await Promise.all(rows.map((r) => loadProgram(r.suggested_program_id)));
    return rows.map<PendingSuggestion>((r, i) => ({
      client_id: r.id,
      client_name: r.full_name,
      primary_complaint: r.primary_complaint,
      program: programs[i],
      source: r.program_suggested_by,
      suggested_at: r.program_suggested_at,
    }));
  });

export const countPendingProgramSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("practitioner_id", context.userId)
      .eq("program_status", "awaiting_practitioner");
    return count ?? 0;
  });

async function assertOwnsClient(userId: string, clientId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("clients")
    .select("practitioner_id")
    .eq("id", clientId)
    .maybeSingle();
  const ownerId = (data as { practitioner_id?: string } | null)?.practitioner_id;
  if (!ownerId || ownerId !== userId) {
    throw new Error("Not authorized");
  }
}

export const approveProgramSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PractClientSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertOwnsClient(context.userId, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        program_status: "pending",
        program_decided_at: new Date().toISOString(),
        program_reminder_snoozed_until: null,
      })
      .eq("id", data.clientId)
      .eq("program_status", "awaiting_practitioner");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const rejectProgramSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PractClientSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertOwnsClient(context.userId, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({
        suggested_program_id: null,
        program_status: "none",
        program_decided_at: null,
        program_personal_note: null,
        program_suggested_by: null,
        program_suggested_at: null,
        program_reminder_snoozed_until: null,
      })
      .eq("id", data.clientId)
      .eq("program_status", "awaiting_practitioner");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

