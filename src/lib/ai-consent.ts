/**
 * AI / POPIA consent gate for Yves and other model-backed features.
 *
 * When `AI_CONSENT_REQUIRED` is true, Yves, Body Forecast, program suggestions,
 * nightly risk analysis, and session-report analysis only run for clients whose
 * stored `yves_ai_consent` is exactly true.
 */
export const AI_CONSENT_REQUIRED = true;

export function hasAiConsent(
  client: { yves_ai_consent?: boolean | null } | null | undefined,
): boolean {
  if (!AI_CONSENT_REQUIRED) return true;
  return client?.yves_ai_consent === true;
}
