import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const checkSignupReady = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: Boolean(process.env.SEED_SERVICE_ROLE_KEY) };
});

const SUPABASE_URL = process.env.SUPABASE_URL!;

const inputSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  profession: z.string().trim().min(1).max(80),
});

export const registerPractitioner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const serviceKey = process.env.SEED_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return { ok: false as const, error: "Server is missing SEED_SERVICE_ROLE_KEY." };
    }
    const admin = createClient(SUPABASE_URL, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: profErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: data.userId,
          role: "practitioner",
          full_name: data.fullName,
          profession: data.profession,
        },
        { onConflict: "id" },
      );
    if (profErr) return { ok: false as const, error: profErr.message };

    const { data: existingPractice } = await admin
      .from("practices")
      .select("id")
      .eq("practitioner_id", data.userId)
      .maybeSingle();

    if (!existingPractice) {
      const { error: prErr } = await admin.from("practices").insert({
        practitioner_id: data.userId,
        practice_name: "",
        profession: data.profession,
        onboarding_complete: false,
        is_approved: false,
      });
      if (prErr) return { ok: false as const, error: prErr.message };
    }

    // Fire platform webhook (best effort, never fail the signup).
    try {
      const { data: settings } = await admin
        .from("platform_settings")
        .select("new_practitioner_webhook_url,new_practitioner_webhook_enabled")
        .limit(1)
        .maybeSingle();
      const url = settings?.new_practitioner_webhook_url?.trim();
      if (settings?.new_practitioner_webhook_enabled && url) {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "new_practitioner_signup",
            practitioner_name: data.fullName,
            practitioner_email: data.email,
            profession: data.profession,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (e) {
      console.error("platform webhook failed", e);
    }

    return { ok: true as const };
  });
