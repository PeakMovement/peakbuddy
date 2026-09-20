import { describe, it, expect } from "vitest";
import { AI_CONSENT_REQUIRED, hasAiConsent } from "./ai-consent";

describe("hasAiConsent", () => {
  it("is enforced (rollout gate is on)", () => {
    expect(AI_CONSENT_REQUIRED).toBe(true);
  });

  it("allows only an explicit true flag", () => {
    expect(hasAiConsent({ yves_ai_consent: true })).toBe(true);
    expect(hasAiConsent({ yves_ai_consent: false })).toBe(false);
    expect(hasAiConsent({ yves_ai_consent: null })).toBe(false);
    expect(hasAiConsent({})).toBe(false);
    expect(hasAiConsent(null)).toBe(false);
    expect(hasAiConsent(undefined)).toBe(false);
  });
});
