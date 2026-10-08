import { supabase } from "@/lib/supabase";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Starts a verified email change for the signed-in user. Supabase emails a
 * confirmation link and only switches the login email once it is tapped.
 * Call updateMyEmail first so taken addresses are refused up front.
 *
 * Returns applied: true only if the project is set to apply email changes
 * without confirmation (the new address is already live on the account).
 */
export async function startVerifiedEmailChange(
  email: string,
  returnPath: string,
): Promise<{ applied: boolean }> {
  const { data, error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${appBaseUrl()}${returnPath}` },
  );
  if (error) {
    throw new Error(
      "We could not start the email change. Please try again, or contact your practice.",
    );
  }
  const live = data.user?.email?.toLowerCase() ?? null;
  return { applied: live === email.toLowerCase() && !data.user?.new_email };
}

export const EMAIL_CHANGE_SENT_NOTICE =
  "We sent a confirmation link. Your email changes once you tap it.";
