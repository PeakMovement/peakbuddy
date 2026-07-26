import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LibraryProgram = {
  id: string;
  name: string;
  goal: string | null;
  applicable_for: string | null;
  description: string;
  image_url: string | null;
  external_url: string;
  symptom_tags: string[];
  duration_label: string | null;
};

/**
 * Client-facing exercise library — the curated, admin-approved programs, newest
 * / highest-priority first. These are non-sensitive marketing/education content,
 * read via the service role behind an authenticated client session.
 */
export const getLibraryPrograms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ programs: LibraryProgram[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("programs")
      .select(
        "id, name, goal, applicable_for, description, image_url, cover_image_url, external_url, symptom_tags, duration_label, priority, created_at",
      )
      .eq("active", true)
      .eq("approved_by_admin", true)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const programs: LibraryProgram[] = (data ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      goal: (p.goal as string | null) ?? null,
      applicable_for: (p.applicable_for as string | null) ?? null,
      description: (p.description as string | null) ?? "",
      image_url: ((p.image_url as string | null) || (p.cover_image_url as string | null)) ?? null,
      external_url: p.external_url as string,
      symptom_tags: ((p.symptom_tags as string[] | null) ?? []).filter(Boolean),
      duration_label: (p.duration_label as string | null) ?? null,
    }));

    return { programs };
  });

/**
 * Returns whether the caller has already seen the library intro (drives the
 * first-visit popup), for their OWN client record only.
 */
export const getLibraryIntroState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ introSeen: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("clients")
      .select("library_intro_seen_at")
      .eq("auth_user_id", context.userId)
      .maybeSingle();
    return { introSeen: !!(data as { library_intro_seen_at?: string | null } | null)?.library_intro_seen_at };
  });

/**
 * Stamps the library intro as seen for the caller's own client. Idempotent —
 * only sets the timestamp the first time.
 */
export const markLibraryIntroSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("clients")
      .update({ library_intro_seen_at: new Date().toISOString() })
      .eq("auth_user_id", context.userId)
      .is("library_intro_seen_at", null);
    return { ok: true };
  });
