import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";

const inputSchema = z.object({
  practitionerId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  primaryComplaint: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().default(""),
  checkInFrequency: z.enum(["daily", "every_2_days", "every_3_days", "weekly"]),
});

export const createClientAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const serviceKey = process.env.SEED_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return { ok: false as const, error: "Server is missing SEED_SERVICE_ROLE_KEY." };
    }

    const admin = createClient(SUPABASE_URL, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Create or find auth user
    let userId: string | null = null;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (createErr) {
      // If user already exists, look them up
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users.find(
          (u) => u.email?.toLowerCase() === data.email.toLowerCase(),
        );
        if (!existing) {
          return { ok: false as const, error: "Email already in use but user not found." };
        }
        // Update password so practitioner can share new credentials
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

    // Insert clients row
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
      })
      .select("id")
      .single();

    if (insErr) {
      return { ok: false as const, error: insErr.message };
    }

    return { ok: true as const, clientId: inserted.id };
  });
