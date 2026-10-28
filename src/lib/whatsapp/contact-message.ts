/**
 * Practitioner messages to someone who is not a Buddy patient.
 *
 * "message Sarah on 082 123 4567: please call the practice" is a contact,
 * not a client. The number is E.164, +27 when no country code was typed.
 * A number that already belongs to a patient stays on the patient path.
 *
 * The intro that can reopen a closed 24 hour window is the utility template
 * buddy_contact_intro (env WHATSAPP_CONTACT_INTRO_TEMPLATE). Meta handover:
 *
 *   name:     buddy_contact_intro
 *   category: UTILITY
 *   language: en
 *   header:   none
 *   footer:   none
 *   body:     Hi {{1}}, this is Buddy. {{2}} asked me to pass on a message.
 *             Reply here and I'll send it straight away. Reply STOP if you'd
 *             rather not get messages on this chat.
 *   {{1}}:    contact name
 *   {{2}}:    practitioner name
 *   buttons:  quick reply "See message" (payload contact_intro)
 *
 * Samples for review: {{1}} Sarah, {{2}} Justin.
 */
import { toE164Digits } from "./phone";

export const CONTACT_INTRO_TEMPLATE_NAME = "buddy_contact_intro";
export const CONTACT_INTRO_TEMPLATE_ENV = "WHATSAPP_CONTACT_INTRO_TEMPLATE";

/** Draft key for wording held until the contact replies. Same idea as a queued check-in. */
export const PENDING_CONTACT_MESSAGE = "pendingContactMessage";

export const CONTACT_INTRO_TEMPLATE = {
  name: CONTACT_INTRO_TEMPLATE_NAME,
  env: CONTACT_INTRO_TEMPLATE_ENV,
  category: "UTILITY",
  language: "en",
  header: null,
  footer: null,
  body: "Hi {{1}}, this is Buddy. {{2}} asked me to pass on a message. Reply here and I'll send it straight away. Reply STOP if you'd rather not get messages on this chat.",
  variables: [
    { index: 1, example: "Sarah", meaning: "contact name" },
    { index: 2, example: "Justin", meaning: "practitioner name" },
  ],
  buttons: [{ type: "QUICK_REPLY", text: "See message", payload: "contact_intro" }],
} as const;

/** Reply when a contact opts out. Not the patient check-in wording: there is no check-in to restart. */
export const CONTACT_OPT_OUT =
  "Done. I won't message this number again. If you need the practice, phone 067 369 0593. In an emergency phone 10177, or 112 from any cellphone.";

const LEAD =
  /^\s*(?:(?:hi|hey|hello|ok|okay)\s+buddy[\s,!.]*)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?/i;

const MESSAGE = new RegExp(
  LEAD.source +
    String.raw`(?:message|text|whatsapp|msg|send)\s+(.+?)\s+(?:on|at)\s+([+0-9][0-9\s().-]{6,}[0-9])\s*(?::|-|–|—|saying|to say)\s*([\s\S]+)$`,
  "i",
);

const PROMOTE_ON = new RegExp(
  LEAD.source +
    String.raw`promote\s+(.+?)\s+(?:on|at)\s+([+0-9][0-9\s().-]{6,}[0-9])\s+to\s+(?:a\s+)?patient\s*[.!?]*$`,
  "i",
);

const PROMOTE = new RegExp(
  LEAD.source + String.raw`promote\s+(.+?)\s+to\s+(?:a\s+)?patient\s*[.!?]*$`,
  "i",
);

const NOT_A_NAME = /^(?:me|us|you|buddy|reception|receptionist|everyone|everybody|them|her|him)$/i;

export interface ContactMessageCommand {
  name: string;
  /** E.164 with a leading plus. */
  phone: string;
  text: string;
}

export interface PromoteContactCommand {
  name: string;
  phone: string | null;
}

/** Digits rewritten to +E.164. A local South African number gets +27. */
export function normaliseContactPhone(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const explicitPlus = raw
    .replace(/^whatsapp:/i, "")
    .trim()
    .startsWith("+");
  const digits = toE164Digits(raw);
  if (!digits) return null;
  // "82 123 4567" is a local mobile with the trunk 0 left off. +27 is the default.
  if (!explicitPlus && digits.length === 9) return `+27${digits}`;
  return `+${digits}`;
}

/** Digits only, for the conversation row and WhatsApp `to`. */
export function contactDigits(phone: string | null | undefined): string | null {
  const plus = normaliseContactPhone(phone);
  return plus ? plus.slice(1) : null;
}

function tidyName(value: string): string | null {
  const name = value
    .replace(/[\s,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length > 80) return null;
  const words = name.split(" ");
  if (words.length > 4) return null;
  if (NOT_A_NAME.test(name)) return null;
  if (/\d/.test(name)) return null;
  return name;
}

function tidyText(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("“") && text.endsWith("”"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.slice(0, 1000);
}

/** "message Sarah on 082 123 4567: please call", or null when it isn't that command. */
export function readContactMessage(text: string): ContactMessageCommand | null {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 1200) return null;
  const matched = raw.match(MESSAGE);
  if (!matched) return null;
  const name = tidyName(matched[1] ?? "");
  const phone = normaliseContactPhone(matched[2] ?? "");
  const body = tidyText(matched[3] ?? "");
  if (!name || !phone || !body) return null;
  return { name, phone, text: body };
}

/** "promote Sarah to patient", optionally "promote Sarah on 082… to patient". */
export function readPromoteContact(text: string): PromoteContactCommand | null {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 200) return null;
  const withPhone = raw.match(PROMOTE_ON);
  if (withPhone) {
    const name = tidyName(withPhone[1] ?? "");
    const phone = normaliseContactPhone(withPhone[2] ?? "");
    if (!name || !phone) return null;
    return { name, phone };
  }
  const matched = raw.match(PROMOTE);
  if (!matched) return null;
  const name = tidyName(matched[1] ?? "");
  if (!name) return null;
  return { name, phone: null };
}

export function templateVariable(value: string, fallback: string): string {
  const flat = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (flat || fallback).slice(0, 60);
}

/** What the practitioner must see before anything is sent. The quoted line is the exact body. */
export function contactPreview(
  name: string,
  phone: string,
  text: string,
  aside: string | null,
): string {
  const extra = aside ? `\n\n${aside}` : "";
  return `Send to ${name} (${phone}):\n\n"${text}"${extra}\n\nSend this?`;
}

export function contactWindowAside(name: string): string {
  return `${name} is outside the 24 hour window, so I'll send the intro template now and queue this message. They'll get it automatically when they reply.`;
}

export function contactTemplateMissing(name: string): string {
  return `The contact intro template isn't configured, so I didn't send anything to ${name}.`;
}

export function contactOptedOut(name: string): string {
  return `${name} asked me to stop messaging this number, so I won't send that.`;
}

export function contactSent(name: string, phone: string, text: string): string {
  return `Sent to ${name} (${phone}): "${text}"`;
}

export function contactQueued(name: string, text: string): string {
  return `Sent ${name} the intro template and queued this message. They'll get it automatically when they reply: "${text}"`;
}

export function promotePreview(name: string, phone: string): string {
  return `Promote ${name} (${phone}) to a patient? I'll add them to your client list and send the usual consent link. They won't get check-ins until they sign.`;
}

/** First token, for a short template variable when the saved name is long. The full name is still the record. */
export function contactDisplayName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 60) || "there";
}
