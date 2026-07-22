import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  practitionerId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
  primaryComplaint: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().default(""),
  checkInFrequency: z.enum(["daily", "every_2_days", "every_3_days", "weekly", "as_needed"]),
  suggestedProgramId: z.string().uuid().nullable().optional(),
  programPersonalNote: z.string().trim().max(280).optional().default(""),
});

export const createClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Authz: only the practitioner adding to their own roster (or a super admin).
    if (context.userId !== data.practitionerId) {
      const { data: prof } = await admin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if (prof?.role !== "super_admin") {
        return { ok: false as const, error: "Forbidden." };
      }
    }
    const { isProgramsFeatureEnabled } = await import("@/lib/client-program.functions");
    const programsEnabled = await isProgramsFeatureEnabled();
    const suggestedProgramId = programsEnabled ? (data.suggestedProgramId ?? null) : null;

    // Guard: refuse to create a second client row for the same email.
    const { data: existingClient } = await admin
      .from("clients")
      .select("id")
      .ilike("email", data.email)
      .limit(1);
    if (Array.isArray(existingClient) && existingClient.length > 0) {
      return {
        ok: false as const,
        error:
          "A client with this email already exists. Open their record instead of adding a new one.",
      };
    }

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
        auth_user_id: userId,
        full_name: data.fullName,
        email: data.email,
        primary_complaint: data.primaryComplaint,
        notes: data.notes ?? "",
        check_in_frequency: data.checkInFrequency,
        popia_accepted: false,
        login_code: String(Math.floor(1000 + Math.random() * 9000)),
        suggested_program_id: suggestedProgramId,
        program_status: suggestedProgramId ? "pending" : "none",
        program_suggested_by: suggestedProgramId ? "practitioner" : null,
        program_suggested_at: suggestedProgramId ? new Date().toISOString() : null,
        program_decided_at: suggestedProgramId ? new Date().toISOString() : null,
        program_personal_note:
          suggestedProgramId && data.programPersonalNote ? data.programPersonalNote : null,
      })

      .select("id")
      .single();

    if (insErr) {
      return { ok: false as const, error: insErr.message };
    }

    // Fire welcome email (best effort — never fail account creation on email issues).
    try {
      const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
      const { data: practitioner } = await admin
        .from("profiles")
        .select("full_name")
        .eq("id", data.practitionerId)
        .maybeSingle();

      // Mint a recovery link so the client can set their own password.
      let setPasswordUrl: string | null = null;
      try {
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: data.email,
          options: { redirectTo: "https://peakbuddy.lovable.app/reset-password" },
        });
        if (!linkErr) {
          setPasswordUrl = linkData?.properties?.action_link ?? null;
        }
      } catch {
        // fall through — email still sends with the temporary password copy
      }

      await sendTransactionalEmailServer({
        templateName: "client-welcome",
        recipientEmail: data.email,
        idempotencyKey: `client-welcome-${inserted.id}`,
        templateData: {
          clientName: data.fullName,
          practitionerName: practitioner?.full_name ?? null,
          email: data.email,
          loginUrl: "https://peakbuddy.lovable.app/client/login",
          setPasswordUrl,
        },
      });
    } catch (e) {
      const { log } = await import("@/lib/log");
      log.error("client welcome email failed", e);
    }

    return { ok: true as const, clientId: inserted.id };
  });
