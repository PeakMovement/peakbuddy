import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const idInput = z.object({ id: z.string().uuid() });

async function assertSuperAdmin(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("is_super_admin", { _uid: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminDeleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client, error: cErr } = await supabaseAdmin
      .from("clients")
      .select("id, auth_user_id, email, phone")
      .eq("id", data.id)
      .maybeSingle();
    if (cErr) return { ok: false as const, error: cErr.message };
    if (!client) return { ok: false as const, error: "Client not found." };

    const { eraseClientRecord } = await import("@/lib/retention.server");
    const erased = await eraseClientRecord(
      supabaseAdmin,
      {
        id: client.id,
        phone: client.phone,
        auth_user_id: client.auth_user_id,
        email: client.email,
      },
      { channel: "admin", actorId: context.userId },
    );
    if (!erased.ok) return { ok: false as const, error: erased.error };
    return { ok: true as const };
  });

export const adminDeletePractitioner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => idInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.id === context.userId) {
      return { ok: false as const, error: "You cannot delete your own admin account." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Deleting the auth user cascades to practices, profiles, clients, check_ins, alerts.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
