import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { log } from "@/lib/log";

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

    // Authz: bind registration to the real auth user. Reject if the userId does
    // not exist or its email does not match the submitted email — prevents
    // creating a practitioner profile/practice for an arbitrary user id.
    const { data: authUser, error: authLookupErr } =
      await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (authLookupErr || !authUser?.user) {
      return { ok: false as const, error: "Invalid account." };
    }
    if ((authUser.user.email ?? "").toLowerCase() !== data.email.toLowerCase()) {
      return { ok: false as const, error: "Account and email do not match." };
    }

    const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
      {
        id: data.userId,
        role: "practitioner",
        full_name: data.fullName,
        profession: data.profession,
      },
      { onConflict: "id" },
    );
    if (profErr) return { ok: false as const, error: profErr.message };

    // Idempotent insert: a retry or double-submit (e.g. slow iPad connection)
    // must not fail on the practices_practitioner_id_key unique constraint.
    // ignoreDuplicates makes the conflict a no-op instead of an error, and
    // never overwrites an existing practice row.
    const { error: prErr } = await supabaseAdmin.from("practices").upsert(
      {
        practitioner_id: data.userId,
        practice_name: "",
        profession: data.profession,
        onboarding_complete: false,
        is_approved: false,
      },
      { onConflict: "practitioner_id", ignoreDuplicates: true },
    );
    if (prErr) return { ok: false as const, error: prErr.message };

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
      log.error("platform webhook failed", e);
    }

    return { ok: true as const };
  });
