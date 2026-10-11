/**
 * Phrase readers for the practitioner inbox (11 Oct 2026, Justin's chat):
 *
 *   "Let's see Lauren's message", "show Nicola's alerts", "what did Lauren say?"
 *   "show my messages", "what's waiting for me?"
 *   "who has checked in this week?", "who checked in today", "check-ins since Monday"
 *
 * Pure text, no database. practitioner-status.server.ts calls these from
 * practitionerIntent; practitioner-inbox.server.ts does the work.
 */
import { toSast } from "./clinic-hours";

const DAY = 86_400_000;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Reading messages or alerts: a client's ("Lauren's message") or all of them ("my messages"). */
export const MESSAGES_REQUEST =
  /\b(?:see|show|read|open|view|get|pull\s+up|bring\s+up|check|let'?s\s+see|what(?:'s|\s+is|\s+are|\s+was|\s+were)?)\b[\s\S]{0,40}\b(?:messages?|msgs?|alerts?|red[\s-]?flags?|flags?|notes?\s+for\s+me|requests?)\b|\b[a-z]+'?s\s+(?:messages?|msgs?|alerts?|red[\s-]?flags?)\b|\bwhat\s+did\s+[a-z]+(?:\s+[a-z]+)?\s+(?:say|write|send|ask|want|need)\b|\b(?:my|the)\s+(?:inbox|messages|alerts)\b|\bwhat'?s\s+waiting\b|\banything\s+(?:new\s+)?for\s+me\b/i;

/** "any red flags?" on its own stays the practice red flag list for owners. */
export function wantsMessages(text: string): boolean {
  return MESSAGES_REQUEST.test(text);
}

/** Who has NOT checked in belongs to "gone quiet". */
const NOT_CHECKED =
  /\b(?:not|hasn'?t|hasnt|haven'?t|havent|didn'?t|didnt|never|yet\s+to)\s+(?:been\s+)?check(?:ed|ing)?[\s-]?in\b/i;

export const CHECKED_IN =
  /\bwho(?:'?s|\s+has|\s+have|\s+did|\s+all)?\s+(?:already\s+)?check(?:ed)?[\s-]?in\b|\b(?:any(?:one|body)|everyone|clients?|patients?)\s+(?:has\s+|have\s+)?check(?:ed)?[\s-]?in\b|\bcheck[\s-]?ins?\s+(?:today|yesterday|this\s+week|last\s+week|since|in\s+the\s+last|over\s+the\s+last|for\s+the\s+(?:week|day))\b|\b(?:today'?s|this\s+week'?s|recent)\s+check[\s-]?ins?\b|\bwho\s+(?:has\s+)?(?:logged|done\s+(?:a|their)\s+check[\s-]?in)\b/i;

export interface CheckedInRange {
  /** Start of the range, epoch ms. */
  since: number;
  /** End (exclusive), epoch ms; null means now. */
  until: number | null;
  /** "today", "this week", "since Monday", "in the last 3 days". */
  label: string;
}

function sastMidnight(now: Date, daysBack = 0): number {
  const d = toSast(new Date(now.getTime() - daysBack * DAY)).date;
  return Date.parse(`${d}T00:00:00+02:00`);
}

/** null when the message isn't about who checked in. */
export function readCheckedIn(text: string, now: Date): CheckedInRange | null {
  if (NOT_CHECKED.test(text) || !CHECKED_IN.test(text)) return null;
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return { since: sastMidnight(now), until: null, label: "today" };
  if (/\byesterday\b/.test(t))
    return { since: sastMidnight(now, 1), until: sastMidnight(now), label: "yesterday" };
  const lastN = t.match(/\b(?:last|past)\s+(\d{1,2})\s+days?\b/);
  if (lastN) {
    const n = Math.min(60, Math.max(1, Number(lastN[1])));
    return { since: now.getTime() - n * DAY, until: null, label: `in the last ${n} days` };
  }
  const weekday = toSast(now).weekday; // 1 = Monday
  if (/\blast\s+week\b/.test(t)) {
    const thisMonday = sastMidnight(now, weekday - 1);
    return { since: thisMonday - 7 * DAY, until: thisMonday, label: "last week" };
  }
  const since = t.match(/\bsince\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (since) {
    const target = DAYS.indexOf(since[1]) + 1;
    const back = (weekday - target + 7) % 7;
    return {
      since: sastMidnight(now, back),
      until: null,
      label: `since ${since[1][0].toUpperCase()}${since[1].slice(1)}`,
    };
  }
  // Default and "this week": since Monday.
  return { since: sastMidnight(now, weekday - 1), until: null, label: "this week" };
}

/** Alert text as the practitioner should read it: no system prefix, one paragraph, capped. */
export function cleanAlertText(message: string | null | undefined, max = 400): string {
  const flat = String(message ?? "")
    .replace(/^(WhatsApp check-in|Red flag detected|Red flag in WhatsApp check-in):\s*/i, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!flat) return "(no details saved)";
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/** Short enough that a bare name is probably just the name ("Lauren Ogg", "Lauren off"). */
export function isShortMessage(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= 4;
}
