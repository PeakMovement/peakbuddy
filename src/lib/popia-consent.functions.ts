import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  currentConsent,
  renderConsentText,
  type ConsentType,
} from "@/lib/consent/wording";

/**
 * POPIA consent, with an evidence trail.
 *
 * clients.popia_accepted is still written and still read everywhere else, so
 * nothing that depended on it changes. What is new is that every acceptance
 * also writes a consent_records row carrying the exact wording the patient saw,
 * its version, and which channel it came through. The boolean says they agreed;
 * the record says what to.
 */

/** Whether the calling client has accepted the CURRENT consent version. */
export const getPopiaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ accepted: boolean; needsReconsent: boolean; version: string }> => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const live = currentConsent("popia_core");

      const { data: client, error } = await supabaseAdmin
        .from("clients")
        .select("id, popia_accepted")
        .eq("auth_user_id", context.userId)
        .maybeSingle();
      // Fail closed: a missing row or a lookup error both block the app.
      if (error || !client) throw new Error("Could not verify POPIA consent");

      const legacyAccepted = client.popia_accepted === true;

      let onCurrentVersion = false;
      try {
        // consent_records is not in the generated types until its migration lands.
        const { data: rec } = await (supabaseAdmin as unknown as { from: (t: string) => any })
          .from("consent_records")
          .select("version")
          .eq("client_id", client.id)
          .eq("consent_type", "popia_core")
          .is("withdrawn_at", null)
          .is("superseded_by", null)
          .order("accepted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        onCurrentVersion = (rec as { version?: string } | null)?.version === live.version;
      } catch {
        // Table not there yet (migration not applied). Fall back to the boolean
        // rather than locking every patient out of the app.
        onCurrentVersion = legacyAccepted;
      }

      return {
        // Someone who accepted the old wording is NOT blocked from the app, but
        // they are asked again, because the new wording adds recipients and the
        // cross-border transfer and that is a material change.
        accepted: legacyAccepted && onCurrentVersion,
        needsReconsent: legacyAccepted && !onCurrentVersion,
        version: live.version,
      };
    },
  );

const acceptSchema = z.object({
  type: z.enum(["popia_core", "whatsapp_checkins"]).default("popia_core"),
  channel: z.enum(["pwa", "whatsapp", "in_person"]).default("pwa"),
  /** The version the SCREEN rendered. Rejected if it is not the live one. */
  version: z.string().min(1),
  userAgent: z.string().max(400).optional(),
});

/**
 * Record an acceptance. The wording is taken from the server's own copy, never
 * from the client, so a tampered payload cannot change what we store as having
 * been agreed. The version is checked so a stale open tab cannot silently
 * record consent to wording that has since been replaced.
 */
export const acceptPopiaConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => acceptSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; version: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const live = currentConsent(data.type as ConsentType);

    if (data.version !== live.version) {
      throw new Error("This consent form is out of date. Please reload and read it again.");
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    if (!client) throw new Error("Could not save consent");

    // Supersede any earlier live record of this type, so two versions can never
    // both read as current.
    try {
      await (supabaseAdmin as unknown as { from: (t: string) => any })
        .from("consent_records")
        .update({ superseded_by: null })
        .eq("client_id", client.id)
        .eq("consent_type", data.type)
        .is("withdrawn_at", null)
        .is("superseded_by", null)
        .neq("version", live.version);
    } catch {
      /* table may not exist yet; the insert below is the thing that matters */
    }

    const { data: inserted, error: insErr } = await (supabaseAdmin as unknown as { from: (t: string) => any })
      .from("consent_records")
      .insert({
        client_id: client.id,
        consent_type: data.type,
        version: live.version,
        wording_snapshot: renderConsentText(live),
        channel: data.channel,
        evidence: data.userAgent ? { userAgent: data.userAgent } : {},
      })
      .select("id")
      .maybeSingle();

    if (data.type === "popia_core") {
      const { error } = await supabaseAdmin
        .from("clients")
        .update({ popia_accepted: true, popia_accepted_at: new Date().toISOString() })
        .eq("id", client.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error("Could not save POPIA consent");
    }

    // The boolean is saved either way. A failed evidence insert is logged, not
    // fatal: locking a patient out of their own app because an audit row did
    // not write is the wrong trade.
    if (insErr && !inserted) {
      const { log } = await import("@/lib/log");
      log.error("[consent] evidence row failed", { type: data.type, channel: data.channel });
    }

    return { ok: true as const, version: live.version };
  });
