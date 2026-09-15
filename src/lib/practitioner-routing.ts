import { supabase } from "@/lib/supabase";

export type PractitionerDestination =
  | "/practitioner/pending"
  | "/practitioner/app/dashboard"
  | "/practitioner/onboarding";

/**
 * Decide where a signed-in practitioner belongs.
 *
 * A practitioner either OWNS a practice (practices.practitioner_id) or is an
 * active MEMBER of someone else's (practice_members). Only an owner ever fills
 * in practice onboarding, so a member must never be routed there: that screen
 * asks them to "Set up your practice", and completing it upserts a practices
 * row in their own name. Since resolvePractitionerPracticeId() checks
 * ownership first, that silently breaks them out of the group practice they
 * were added to.
 *
 * Group practices shipped without this check, so every non-owner member landed
 * on onboarding at first sign-in.
 */
export async function practitionerDestination(userId: string): Promise<PractitionerDestination> {
  const { data: owned } = await supabase
    .from("practices")
    .select("onboarding_complete,is_approved")
    .eq("practitioner_id", userId)
    .maybeSingle();

  if (owned) {
    if (owned.is_approved === false) return "/practitioner/pending";
    return owned.onboarding_complete ? "/practitioner/app/dashboard" : "/practitioner/onboarding";
  }

  // Not an owner. An active membership means their practice is already set up
  // by its owner, so they go straight in.
  const { data: membership } = await supabase
    .from("practice_members")
    .select("practice_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!membership?.practice_id) return "/practitioner/onboarding";

  // Mirror the owner's pending-approval gate. If RLS hides the practice row
  // from a member, fall through to the dashboard — server functions enforce
  // the real access checks.
  const { data: practice } = await supabase
    .from("practices")
    .select("is_approved")
    .eq("id", membership.practice_id)
    .maybeSingle();

  if (practice?.is_approved === false) return "/practitioner/pending";
  return "/practitioner/app/dashboard";
}
