import { describe, it, expect } from "vitest";
import {
  CURRENT_CONSENTS,
  POPIA_CORE_V2,
  WHATSAPP_CHECKINS_V1,
  currentConsent,
  renderConsentText,
} from "./wording";

/**
 * These tests are a compliance checklist, not a formatting check. If someone
 * edits the wording and drops the cross-border sentence, or the emergency
 * numbers, or how to withdraw, a test goes red rather than a patient being
 * handed a consent form that no longer says what POPIA requires it to say.
 */

const core = renderConsentText(POPIA_CORE_V2).toLowerCase();

describe("the core consent says what POPIA requires", () => {
  it("names what is collected", () => {
    expect(core.includes("what we collect")).toBe(true);
  });

  it("says why", () => {
    expect(core.includes("physiotherapist")).toBe(true);
  });

  it("names the actual recipients rather than a vague category", () => {
    for (const vendor of ["lovable", "anthropic", "google", "microsoft", "meta"]) {
      expect(core.includes(vendor)).toBe(true);
    }
  });

  it("says where the records physically sit", () => {
    expect(core.includes("germany")).toBe(true);
  });

  it("states the cross-border transfer explicitly", () => {
    expect(core.includes("outside south africa")).toBe(true);
  });

  it("says it is not for advertising and not sold", () => {
    expect(core.includes("never sell")).toBe(true);
    expect(core.includes("advertising")).toBe(true);
  });

  it("warns it is not an emergency service and gives real numbers", () => {
    expect(core.includes("not an emergency service")).toBe(true);
    expect(core.includes("10177")).toBe(true);
    expect(core.includes("112")).toBe(true);
  });

  it("gives a retention position", () => {
    expect(core.includes("90 days")).toBe(true);
    expect(core.includes("how long we keep it")).toBe(true);
  });

  it("explains how to withdraw, on both channels", () => {
    expect(core.includes("withdraw")).toBe(true);
    expect(core.includes("stop")).toBe(true);
    expect(core.includes("hello@peakmovement.co.za")).toBe(true);
  });

  it("says withdrawing does not affect treatment, which POPIA needs for consent to be voluntary", () => {
    expect(core.includes("will not affect your treatment")).toBe(true);
  });

  it("carries an explicit affirmation rather than implying agreement", () => {
    expect(core.includes("agreement: i have read the above")).toBe(true);
  });
});

describe("the WhatsApp consent is separate and specific", () => {
  const wa = renderConsentText(WHATSAPP_CHECKINS_V1).toLowerCase();
  it("names Meta", () => expect(wa.includes("meta")).toBe(true));
  it("explains STOP", () => expect(wa.includes("stop")).toBe(true));
  it("says it is not watched around the clock", () => {
    expect(wa.includes("around the clock")).toBe(true);
  });
  it("is its own consent type, so it can be withdrawn without withdrawing the rest", () => {
    expect(WHATSAPP_CHECKINS_V1.type).toBe("whatsapp_checkins");
    expect(POPIA_CORE_V2.type).toBe("popia_core");
  });
});

describe("the snapshot is a faithful record of what was shown", () => {
  it("contains every section body verbatim", () => {
    const text = renderConsentText(POPIA_CORE_V2);
    for (const s of POPIA_CORE_V2.sections) expect(text.includes(s.body)).toBe(true);
  });

  it("contains the affirmation verbatim", () => {
    expect(renderConsentText(POPIA_CORE_V2).includes(POPIA_CORE_V2.affirmation)).toBe(true);
  });

  it("carries the version, so a stored record identifies itself", () => {
    expect(renderConsentText(POPIA_CORE_V2).includes(POPIA_CORE_V2.version)).toBe(true);
  });

  it("changes when the wording changes", () => {
    const edited = {
      ...POPIA_CORE_V2,
      sections: [...POPIA_CORE_V2.sections.slice(1)],
    };
    expect(renderConsentText(edited) === renderConsentText(POPIA_CORE_V2)).toBe(false);
  });
});

describe("version bookkeeping", () => {
  it("every current consent is reachable by type", () => {
    expect(currentConsent("popia_core").version).toBe("2026-10-07.1");
    expect(currentConsent("whatsapp_checkins").version).toBe("2026-10-07.1");
    expect(renderConsentText(currentConsent("popia_core"))).toContain("Google Drive");
    expect(renderConsentText(currentConsent("whatsapp_checkins"))).toContain("Google Drive");
    expect(renderConsentText(currentConsent("popia_core"))).not.toContain("90 days");
  });

  it("every registered consent has a version and an effective date", () => {
    for (const v of Object.values(CURRENT_CONSENTS)) {
      expect(v.version.length > 0).toBe(true);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(v.effectiveFrom)).toBe(true);
    }
  });

  it("every registered consent has an affirmation and at least one section", () => {
    for (const v of Object.values(CURRENT_CONSENTS)) {
      expect(v.affirmation.length > 20).toBe(true);
      expect(v.sections.length > 0).toBe(true);
    }
  });
});
