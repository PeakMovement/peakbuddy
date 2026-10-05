/**
 * Getting a patient onto Buddy through WhatsApp, without an app sign-up.
 *
 * The idea (Justin, 5 Oct): instead of sending a sign-up link, the practice
 * shares a "Chat to Buddy" link. Tapping it opens WhatsApp with a message to
 * Buddy already typed, including a short code. The patient taps send, and
 * because THEY sent the first message, Meta allows Buddy to reply freely, so
 * no message templates are needed for any of this.
 *
 *   Client invite  (JOIN-XXXXXX, one patient): the practitioner added them in
 *     Buddy. The code links this WhatsApp number to that profile.
 *   Practice link  (JOIN-XXXXXX, whole practice): posters, reception QR, the
 *     website. Buddy asks their name and which practitioner they see, creates
 *     the profile and links it to that practitioner.
 *
 * Either way, nothing is collected until consent is signed on the consent page
 * Buddy sends a personal link to. Existing profiles are checked the same way:
 * no current consent, no check-in, just the link.
 *
 * Pure helpers only. The worker and server functions do the writes.
 */

export const BUDDY_WHATSAPP_NUMBER = "27675724314";
export const APP_ORIGIN = "https://peakbuddy.lovable.app";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

/** A fresh 6 character code. Callers retry on the rare collision. */
export function newInviteCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

/** The code inside a message, if there is one. Case and spacing forgiving. */
export function parseJoinCode(text: string): string | null {
  const m = text.match(/\bjoin[\s-]*([a-z0-9]{6})\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** The message text with the code removed, so the rest reads normally. */
export function stripJoinCode(text: string): string {
  return text
    .replace(/\(?\s*\bjoin[\s-]*[a-z0-9]{6}\b\s*\)?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The wa.me link that opens a chat with Buddy, message pre-typed. */
export function chatToBuddyLink(code: string, kind: "client" | "practice"): string {
  const text =
    kind === "client"
      ? `Hi Buddy, I'd like to start my check-ins (JOIN-${code})`
      : `Hi Buddy, I'm a patient and I'd like to join (JOIN-${code})`;
  return `https://wa.me/${BUDDY_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function consentPageUrl(token: string): string {
  return `${APP_ORIGIN}/consent?t=${encodeURIComponent(token)}`;
}

export interface PractitionerOption {
  id: string;
  name: string;
}

/**
 * Who they said they see, from a typed answer. Matches whole first or last
 * names, case-insensitive, ignoring titles. Ambiguous or no match: null, and
 * Buddy shows the list again rather than guessing.
 */
export function matchPractitioner(
  text: string,
  options: PractitionerOption[],
): PractitionerOption | null {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/\b(dr|mr|mrs|ms|miss)\.?\b/g, " ")
      .split(/[^a-z']+/)
      .filter((w) => w.length >= 3),
  );
  if (words.size === 0) return null;
  const hits = options.filter((o) =>
    o.name
      .toLowerCase()
      .split(/[^a-z']+/)
      .some((part) => part.length >= 3 && words.has(part)),
  );
  return hits.length === 1 ? hits[0] : null;
}

/** "Thandi Mokoena" from "my name is thandi mokoena". Null if it doesn't look like a name. */
export function readName(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^(hi|hello|hey)[,!.\s]+/i, "")
    .replace(/^(my name is|my name's|i am|i'm|it's|its|this is|name:?)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (!/^[\p{L}][\p{L}'’ .-]*$/u.test(cleaned)) return null;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 5) return null;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

export function looksLikeEmail(text: string): string | null {
  const m = text.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
  return m ? m[0].toLowerCase() : null;
}

export const ONBOARD_MSG = {
  practiceWelcome: (practiceName: string) =>
    `Hi, welcome to Buddy from ${practiceName}! I'm the practice's check-in assistant on WhatsApp. To set you up, what's your full name?`,
  nameRetry: "Sorry, I didn't catch that. What's your full name? For example: Thandi Mokoena",
  askPractitioner: (firstName: string) =>
    `Thanks ${firstName}. Which practitioner have you been seeing? Pick them from the list.`,
  practitionerRetry:
    "Please pick your practitioner from the list so I link you to the right person.",
  linked: (firstName: string, practitionerName: string) =>
    `Great, ${firstName}, you're linked to ${practitionerName}.`,
  inviteWelcome: (firstName: string, practiceName: string) =>
    `Hi ${firstName}, welcome to Buddy from ${practiceName}! I'll check in with you here between appointments and pass your answers to your practitioner.`,
  inviteInvalid:
    "Sorry, that join code isn't working. It may have expired. Please ask the practice for a new link.",
  consentLink: (firstName: string, url: string) =>
    `Before we start, ${firstName}, please read and sign your consent form. It takes about a minute:\n\n${url}\n\nCome back here once you've signed and we'll do your first check-in.`,
  consentReminder: (url: string) =>
    `I just need your signed consent before we can carry on. Here's your link again:\n\n${url}`,
  consentDone: (firstName: string) =>
    `Thank you ${firstName}, your consent is signed and saved to your profile. Let's do your first check-in.`,
  appOffer:
    "By the way, there's also a Buddy app with your progress charts, exercises and smartwatch syncing. Want me to set it up for you? Reply with your email address, or NO THANKS.",
  appAskAgain: "That doesn't look like an email address. Reply with your email, or NO THANKS.",
  appSetUp: (email: string) =>
    `Done. I've sent an email to ${email} so you can set your password and log in. WhatsApp check-ins carry on as normal.`,
  appEmailTaken:
    "That email is already linked to a Buddy account. Please log in with it in the app, or ask the practice to help.",
  appDeclined: "No problem. WhatsApp is all you need. If you ever want the app, just say APP.",
} as const;
