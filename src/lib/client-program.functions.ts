import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProgramLite = {
  id: string;
  name: string;
  description: string;
  external_url: string;
  image_url: string | null;
};

export type ClientProgramState = {
  client_id: string;
  program: ProgramLite | null;
  status: "none" | "pending" | "accepted" | "declined";
  decided_at: string | null;
  first_login: boolean;
};

// Public: list of active programs (id + name) for practitioner dropdown.
export const listActivePrograms = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("programs")
    .select("id, name")
    .eq("active", true)
    .order("priority", { ascending: false })
    .order("name", { ascending: true });
  if (error) return [] as { id: string; name: string }[];
  return (data ?? []) as { id: string; name: string }[];
});

async function loadClientByAuth(email: string | null) {
  if (!email) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("clients")
    .select(
      "id, suggested_program_id, program_status, program_decided_at, first_login_at",
    )
    .ilike("email", email)
    .maybeSingle();
  return data as
    | {
        id: string;
        suggested_program_id: string | null;
        program_status: "none" | "pending" | "accepted" | "declined";
        program_decided_at: string | null;
        first_login_at: string | null;
      }
    | null;
}

async function loadProgram(id: string | null): Promise<ProgramLite | null> {
  if (!id) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("programs")
    .select("id, name, description, external_url, image_url")
    .eq("id", id)
    .maybeSingle();
  return (data as ProgramLite | null) ?? null;
}

// Called by the client app on mount. Stamps first_login_at the first time and returns
// the assigned-program state so the welcome modal can be shown.
export const getClientBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client) {
      return {
        client_id: "",
        program: null,
        status: "none" as const,
        decided_at: null,
        first_login: false,
      } satisfies ClientProgramState;
    }

    const wasFirstLogin = client.first_login_at === null;
    if (wasFirstLogin) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("clients")
        .update({ first_login_at: new Date().toISOString() })
        .eq("id", client.id);
    }

    const program = await loadProgram(client.suggested_program_id);
    return {
      client_id: client.id,
      program,
      status: client.program_status,
      decided_at: client.program_decided_at,
      first_login: wasFirstLogin,
    } satisfies ClientProgramState;
  });

// Returns current program state without mutating first_login_at — for the profile page.
export const getMyProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client) {
      return {
        client_id: "",
        program: null,
        status: "none" as const,
        decided_at: null,
        first_login: false,
      } satisfies ClientProgramState;
    }
    const program = await loadProgram(client.suggested_program_id);
    return {
      client_id: client.id,
      program,
      status: client.program_status,
      decided_at: client.program_decided_at,
      first_login: false,
    } satisfies ClientProgramState;
  });

const RespondSchema = z.object({ accept: z.boolean() });

export const respondToSuggestedProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RespondSchema.parse(input))
  .handler(async ({ data, context }) => {
    const email = (context.claims?.email as string | undefined) ?? null;
    const client = await loadClientByAuth(email);
    if (!client || !client.suggested_program_id) {
      return { ok: false as const, error: "No suggested program." };
    }
    const status: "accepted" | "declined" = data.accept ? "accepted" : "declined";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ program_status: status, program_decided_at: new Date().toISOString() })
      .eq("id", client.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, status };
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
      .select(
        "id, suggested_program_id, program_status, program_decided_at, first_login_at, practitioner_id",
      )
      .eq("id", data.clientId)
      .maybeSingle();
    if (!c) return null;
    // Authorize: must be the practitioner who owns the client, or super admin.
    const isOwner = c.practitioner_id === context.userId;
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
    const program = await loadProgram(c.suggested_program_id);
    return {
      program,
      status: c.program_status as "none" | "pending" | "accepted" | "declined",
      decided_at: c.program_decided_at as string | null,
    };
  });
