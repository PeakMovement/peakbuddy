import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncClientWearablesAsAdmin, type AdminSyncResult } from "./admin-wearable-sync.server";

export type { AdminSyncResult };

/** Super-admin only: run a wearable sync on behalf of a client from the Data Hub. */
export const adminSyncClientWearables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ clientId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<AdminSyncResult> => {
    const { data: profile } = await context.supabase
      .from("profiles").select("role").eq("id", context.userId).maybeSingle();
    if (!profile || profile.role !== "super_admin") throw new Error("Forbidden");
    return syncClientWearablesAsAdmin(data.clientId);
  });
