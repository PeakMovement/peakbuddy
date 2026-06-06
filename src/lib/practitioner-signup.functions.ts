import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const checkSignupReady = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: true };
});

const inputSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  profession: z.string().trim().min(1).max(80),
});

export const registerPractitioner = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: profErr } = await supabaseAdmin
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

    const { data: existingPractice } = await supabaseAdmin
      .from("practices")
      .select("id")
      .eq("practitioner_id", data.userId)
      .maybeSingle();

    if (!existingPractice) {
      const { error: prErr } = await supabaseAdmin.from("practices").insert({
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
      const { data: settings } = await supabaseAdmin
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
