import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server functions for WhatsApp onboarding.
 *
 * Two are PUBLIC on purpose: the consent page is opened from a WhatsApp link
 * by someone who has no Buddy login. The 256-bit single-use token in the link
 * is the only key, it is stored hashed, and it expires after 7 days.
 *
 * The other two are for practitioners and check access before doing anything.
 */

const tokenSchema = z.object({ token: z.string().min(20).max(100) });

export const getConsentLinkDetails = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tokenSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { readConsentLink } = await import("./onboarding.server");
    const r = await readConsentLink(supabaseAdmin as unknown as SupabaseClient, data.token);
    if (!r.ok) return { ok: false as const, reason: r.reason };
    return {
      ok: true as const,
      firstName: r.info.firstName,
      practiceName: r.info.practiceName,
      alreadySigned: r.info.alreadySigned,
      aiConsent: r.info.aiConsent,
    };
  });

export const signConsentLink = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(20).max(100),
        aiConsent: z.boolean(),
        userAgent: z.string().max(400).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as SupabaseClient;
    const { acceptConsentLink } = await import("./onboarding.server");
    const r = await acceptConsentLink(admin, data.token, {
      aiConsent: data.aiConsent,
      userAgent: data.userAgent,
    });
    if (!r.ok) return { ok: false as const, reason: r.reason };

    // Carry on in WhatsApp straight away: they messaged Buddy moments ago, so
    // a free-form reply is allowed. Best effort; if it fails, their next
    // message picks up from here anyway.
    if (r.info.phone) {
      try {
        const { continueAfterConsent } = await import("./worker.server");
        await continueAfterConsent(admin, r.info.clientId, r.info.phone, r.info.firstName);
      } catch {
        /* the patient's next message carries on */
      }
    }
    return { ok: true as const, firstName: r.info.firstName };
  });

export const getWhatsAppInviteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canAccessClient } = await import("@/lib/practice-members.functions");
    const access = await canAccessClient(supabaseAdmin, context.userId, data.clientId);
    if (!access.allowed) return { ok: false as const, error: "Not authorised." };
    const { clientInviteLink } = await import("./onboarding.server");
    const r = await clientInviteLink(
      supabaseAdmin as unknown as SupabaseClient,
      data.clientId,
      context.userId,
    );
    return r
      ? { ok: true as const, ...r }
      : { ok: false as const, error: "Could not create a link." };
  });

export const getPracticeWhatsAppLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolvePractitionerPracticeId } = await import("@/lib/practice-members.functions");
    const practice = await resolvePractitionerPracticeId(supabaseAdmin, context.userId);
    if (!practice) return { ok: false as const, error: "You're not part of a practice yet." };
    const { practiceInviteLink } = await import("./onboarding.server");
    const r = await practiceInviteLink(
      supabaseAdmin as unknown as SupabaseClient,
      practice.practiceId,
      context.userId,
    );
    return r
      ? { ok: true as const, ...r }
      : { ok: false as const, error: "Could not create a link." };
  });
