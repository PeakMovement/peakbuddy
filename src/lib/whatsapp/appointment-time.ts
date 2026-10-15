/**
 * A time reception typed, turned into the next matching instant in
 * Africa/Johannesburg. Nothing is stored until the physio confirms.
 */
import { rankPatients } from "./practitioner-understand";

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

export interface ParsedVisit {
  /** ISO timestamp with a +02:00 offset. */
  iso: string;
  /** What the physio is asked to confirm. */
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** SAST wall clock as an ISO string. South Africa does not use daylight saving. */
export function sastIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+02:00`;
}

function sastParts(now: Date): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: map[get("weekday")] ?? 0,
  };
}

function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

function clock(text: string): { hour: number; minute: number } | null {
  const match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const mer = match[3]?.toLowerCase();
  if (minute > 59 || hour > 23) return null;
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  if (!mer && hour > 23) return null;
  if (mer && hour > 23) return null;
  if (!mer && hour <= 7) return null;
  return { hour, minute };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Pull one visit time out of reception's reply. Null when there is no clock
 * time, so a "Friday is full" does not become an appointment.
 */
export function parseVisitTime(text: string, now: Date): ParsedVisit | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const time = clock(raw);
  if (!time) return null;
  const dayWord = raw.toLowerCase().match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/,
  );
  const today = sastParts(now);
  let when = { year: today.year, month: today.month, day: today.day };
  let weekday = today.weekday;
  if (dayWord) {
    const target = WEEKDAYS[dayWord[1]];
    let delta = (target - today.weekday + 7) % 7;
    if (delta === 0) {
      const nowMin = now.getTime();
      const candidate = new Date(sastIso(today.year, today.month, today.day, time.hour, time.minute));
      if (candidate.getTime() <= nowMin) delta = 7;
    }
    when = addDays(today.year, today.month, today.day, delta);
    weekday = target;
  }
  const iso = sastIso(when.year, when.month, when.day, time.hour, time.minute);
  const label = `${WEEKDAY_NAMES[weekday]} ${when.day} ${MONTHS[when.month - 1]} at ${pad(time.hour)}:${pad(time.minute)}`;
  return { iso, label };
}

export function appointmentConfirmLine(name: string, label: string): string {
  return `Save ${label} as ${name}'s next visit? Reply YES to store that time, or NO to leave it. I will not invent a slot.`;
}

/**
 * One client named in the errand, and a clock time in the reply.
 * Two matches, or no clock, stores nothing.
 */
export function singleNamedVisit(
  requestText: string,
  replyText: string,
  patients: Array<{ id: string; full_name: string | null }>,
  now: Date,
): { clientId: string; name: string; iso: string; label: string } | null {
  const visit = parseVisitTime(replyText, now);
  if (!visit) return null;
  const hits = rankPatients(requestText, patients);
  if (hits.length !== 1) return null;
  const name = String(hits[0].patient.full_name ?? "").trim();
  if (!name) return null;
  return { clientId: hits[0].patient.id, name, iso: visit.iso, label: visit.label };
}
