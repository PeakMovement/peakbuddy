import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  practitionerId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  primaryComplaint: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().default(""),
  checkInFrequency: z.enum(["daily", "every_2_days", "every_3_days", "weekly"]),
  suggestedProgramId: z.string().uuid().nullable().optional(),
});


export const createClientAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Create or find auth user
    let userId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users.find(
          (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
        );
        if (!existing) {
          return { ok: false as const, error: "Email already in use but user not found." };
        }
        await admin.auth.admin.updateUserById(existing.id, { password: data.password });
        userId = existing.id;
      } else {
        return { ok: false as const, error: createErr.message };
      }
    } else {
      userId = created.user?.id ?? null;
    }

    if (!userId) {
      return { ok: false as const, error: "Failed to create auth user." };
    }

    const { data: inserted, error: insErr } = await admin
      .from("clients")
      .insert({
        practitioner_id: data.practitionerId,
        full_name: data.fullName,
        email: data.email,
        primary_complaint: data.primaryComplaint,
        notes: data.notes ?? "",
        check_in_frequency: data.checkInFrequency,
        popia_accepted: false,
        login_code: String(Math.floor(1000 + Math.random() * 9000)),
      })
      .select("id")
      .single();

    if (insErr) {
      return { ok: false as const, error: insErr.message };
    }

    return { ok: true as const, clientId: inserted.id };
  });
