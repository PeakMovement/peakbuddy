/**
 * Consent wording, versioned.
 *
 * ONE source for the text. The screen renders from here and the server stores
 * the exact same string on the consent record, so what a patient saw and what
 * we can later prove they saw cannot drift apart. That is the whole point:
 * POPIA puts the burden of proving consent on the responsible party, and a
 * boolean saying "they agreed" proves nothing about what they agreed to.
 *
 * RULES FOR CHANGING THIS FILE
 *
 * 1. Never edit a published version's text. Add a new version.
 * 2. Bump the version whenever the SUBSTANCE changes: a new recipient, a new
 *    purpose, a new country, a different retention period. Typos and layout do
 *    not need a bump; anything a patient might have decided differently about
 *    does.
 * 3. A material change means existing patients arguably have to re-consent for
 *    the new processing. That is an operational decision, not a code one.
 *
 * Recipients below are taken from the POPIA operator register, so when a vendor
 * is added or removed there, it changes here too.
 */

export type ConsentType = "popia_core" | "whatsapp_checkins";

export interface ConsentVersion {
  type: ConsentType;
  /** Monotonic within a type. Stored on the record. */
  version: string;
  effectiveFrom: string;
  /** Shown above the checkbox. */
  heading: string;
  /** Rendered in order. Each becomes a paragraph. */
  sections: Array<{ heading?: string; body: string }>;
  /** The sentence beside the checkbox. This is the operative agreement. */
  affirmation: string;
}

const RECIPIENTS =
  "Lovable, which runs the Buddy software and stores your records on servers in Germany; " +
  "Anthropic, whose AI reads your messages to summarise them for your physiotherapist; " +
  "Google and Microsoft, whose European cloud services carry some of that processing; " +
  "and, if you use the WhatsApp check-ins, Meta, who operate WhatsApp.";

export const POPIA_CORE_V2: ConsentVersion = {
  type: "popia_core",
  version: "2026-10-04.1",
  effectiveFrom: "2026-10-04",
  heading: "Before you start",
  sections: [
    {
      heading: "What we collect",
      body:
        "The symptoms and check-ins you log: pain, how you are moving, how you are sleeping, how your exercises are going, and anything you tell us in your own words. Your name and contact details. If you connect a wearable, the health data it sends.",
    },
    {
      heading: "Why",
      body:
        "So your physiotherapist can see how you are doing between appointments, adjust your treatment, and notice early if something needs attention sooner.",
    },
    {
      heading: "Who else sees it",
      body: `Your clinical team at Peak Movement reads it. Behind the scenes it is handled by ${RECIPIENTS} We never sell your information and we never share it for advertising.`,
    },
    {
      heading: "It leaves South Africa",
      body:
        "Because of the above, your information is processed outside South Africa, mainly in the European Union. Those providers are required to protect it to a standard comparable to South African law.",
    },
    {
      heading: "This is not an emergency service",
      body:
        "Nobody watches Buddy around the clock. If something is wrong and it cannot wait, phone an ambulance on 10177, or 112 from any cellphone, or go to your nearest emergency unit. Please do not wait for a reply from us.",
    },
    {
      heading: "How long we keep it",
      body:
        "Your check-ins stay with your clinical record for as long as we are required to keep clinical records. Raw WhatsApp messages are deleted after 90 days, and only the summarised information stays on your record.",
    },
    {
      heading: "Changing your mind",
      body:
        "You can withdraw at any time and it will not affect your treatment. In the app, ask your physiotherapist or email hello@peakmovement.co.za. On WhatsApp, reply STOP and the messages end immediately. You can also ask us for a copy of what we hold, or ask us to correct it.",
    },
  ],
  affirmation:
    "I have read the above. I consent to Peak Movement collecting and processing my personal and health information as described, including it being processed outside South Africa, and to it being shared with my treating clinical team.",
};

export const WHATSAPP_CHECKINS_V1: ConsentVersion = {
  type: "whatsapp_checkins",
  version: "2026-10-04.1",
  effectiveFrom: "2026-10-04",
  heading: "WhatsApp check-ins",
  sections: [
    {
      body:
        "Buddy can check in with you on WhatsApp between appointments and pass your answers to your physiotherapist. Messages travel through WhatsApp, which is run by Meta.",
    },
    {
      body:
        "Replying STOP ends the check-ins immediately and permanently, with no effect on your treatment. Nobody watches this line around the clock, so in an emergency phone 10177, or 112 from any cellphone, rather than waiting for a reply.",
    },
  ],
  affirmation:
    "I consent to Peak Movement sending me check-in messages on WhatsApp and processing my replies as part of my care.",
};

export const CURRENT_CONSENTS: Record<ConsentType, ConsentVersion> = {
  popia_core: POPIA_CORE_V2,
  whatsapp_checkins: WHATSAPP_CHECKINS_V1,
};

/**
 * The exact string stored on the consent record. Built from the version so it
 * cannot be written by hand and cannot disagree with what was rendered.
 */
export function renderConsentText(v: ConsentVersion): string {
  const parts = [`${v.heading} (version ${v.version})`];
  for (const s of v.sections) {
    parts.push(s.heading ? `${s.heading}\n${s.body}` : s.body);
  }
  parts.push(`AGREEMENT: ${v.affirmation}`);
  return parts.join("\n\n");
}

export function currentConsent(type: ConsentType): ConsentVersion {
  return CURRENT_CONSENTS[type];
}
