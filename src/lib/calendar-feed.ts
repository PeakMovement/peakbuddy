// Pure iCal (RFC 5545) generator for a client's rehab reminder feed.
// One-way subscription feed; calendar apps (Google/Apple/Outlook) sync it.

export type ReminderSchedule = {
  enabled: boolean;
  frequency: string; // daily | morning | evening | custom
  time_of_day: string; // "HH:MM" or "HH:MM:SS"
  days_of_week: number[]; // 0=Sun .. 6=Sat
  timezone: string; // IANA, e.g. "Africa/Johannesburg"
} | null;

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function fold(lines: string[]): string {
  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}

function hhmmss(time: string): string {
  const [h = "0", m = "0"] = time.split(":");
  return `${h.padStart(2, "0")}${m.padStart(2, "0")}00`;
}

function dtstamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}

// A start date (YYYYMMDD) whose weekday equals the earliest selected day,
// so DTSTART aligns with the RRULE BYDAY set.
function startDate(days: number[]): string {
  const sundayAnchor = new Date(Date.UTC(2024, 0, 7)); // a Sunday (dow 0)
  const minDay = Math.min(...days);
  const d = new Date(sundayAnchor);
  d.setUTCDate(7 + minDay);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

export function buildRehabIcs(opts: {
  clientId: string;
  appBase: string;
  reminder: ReminderSchedule;
  title?: string;
  now?: Date;
}): string {
  const { clientId, appBase, reminder } = opts;
  const now = opts.now ?? new Date();
  const title = opts.title || "Buddy rehab reminder";

  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buddy//Rehab Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Buddy Rehab",
    "X-PUBLISHED-TTL:PT6H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];

  const tail = ["END:VCALENDAR"];

  if (!reminder || !reminder.enabled || reminder.days_of_week.length === 0) {
    return fold([...head, ...tail]);
  }

  const days = [...new Set(reminder.days_of_week)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const allDays = days.length === 7;
  const rrule = allDays ? "RRULE:FREQ=DAILY" : `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => DOW[d]).join(",")}`;
  const tz = reminder.timezone || "UTC";
  const dt = `${startDate(days)}T${hhmmss(reminder.time_of_day)}`;

  const vevent = [
    "BEGIN:VEVENT",
    `UID:buddy-rehab-${clientId}@buddytracker.netlify.app`,
    `DTSTAMP:${dtstamp(now)}`,
    `DTSTART;TZID=${tz}:${dt}`,
    "DURATION:PT15M",
    rrule,
    `SUMMARY:${title}`,
    `DESCRIPTION:Time for your rehab check-in. Open Buddy: ${appBase}/client/app/checkin`,
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Rehab reminder",
    "END:VALARM",
    "END:VEVENT",
  ];

  return fold([...head, ...vevent, ...tail]);
}
