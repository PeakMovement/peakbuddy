/**
 * Pre-rollout AI consent switch.
 *
 * While `AI_CONSENT_REQUIRED` is false, Yves features are available to every
 * client regardless of their stored `yves_ai_consent` value. All existing
 * consent records, the client profile toggle and the admin display are
 * untouched — flipping this to `true` re-enforces every gate immediately.
 */
export const AI_CONSENT_REQUIRED = false;

export function hasAiConsent(
  client: { yves_ai_consent?: boolean | null } | null | undefined,
): boolean {
  if (!AI_CONSENT_REQUIRED) return true;
  return client?.yves_ai_consent === true;
}
