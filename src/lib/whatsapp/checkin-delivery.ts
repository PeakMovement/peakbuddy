/**
 * Whether today's check-ins went out. Pure: the cron, the admin page, and
 * the super-admin WhatsApp reply all use this.
 *
 * A row in whatsapp_outbound with one of the notes below is a delivery
 * outcome, not a message the patient was sent. sent_ok is false.
 */
import { reminderDueOnWeekday, normalizeDays } from "./schedule";

export const CHECKIN_NOTE_WINDOW = "[check-in not sent: window closed]";
export const CHECKIN_NOTE_FAILED = "[check-in not sent: delivery failed]";

/** Template name Claude registers. The env var selects it; unset means no WhatsApp alert. */
export const CHECKIN_ALERT_TEMPLATE = "buddy_checkin_delivery_alert";
export const CHECKIN_ALERT_BUTTON = "prac_checkin_delivery";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type DeliveryOutcome = "sent" | "failed" | "window_closed" | "waiting" | "not_due";

export interface DeliveryReminder {
  clientId: string;
  name: string;
  days: unknown;
  /** "HH:MM" or "HH:MM:SS". */
  time: string;
  lastSentOn: string | null;
}

export interface DeliveryMessage {
  clientId: string;
  body: string;
  sentOk: boolean;
  at: string;
}

export interface DeliveryRow {
  name: string;
  when: string;
  outcome: DeliveryOutcome;
  replied: boolean;
}

export interface DeliverySummary {
  date: string;
  due: number;
  sent: number;
  failed: number;
  windowClosed: number;
  waiting: number;
  replied: number;
  rows: DeliveryRow[];
}

export function isCheckinDeliveryAsk(text: string): boolean {
  return /\bdid\s+(?:the\s+)?check[\s-]?ins?\s+go\s+out\b|\bcheck[\s-]?ins?\s+(?:status|delivery)\b|\bwere\s+(?:the\s+)?check[\s-]?ins?\s+sent\b/i.test(
    text.trim(),
  );
}

export function shouldAlertDelivery(input: {
  undelivered: number;
  delivered: number;
  alreadyAlerted: boolean;
}): boolean {
  return input.undelivered > 0 && input.delivered === 0 && !input.alreadyAlerted;
}

function sastDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function minutes(time: string): number {
  const [h, m] = time.split(":").map((x) => Number(x));
  if (!Number.isFinite(h)) return 0;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function whenLabel(days: unknown, time: string): string {
  const names = normalizeDays(days).map((d) => DAY[d] ?? "");
  const hhmm = time.slice(0, 5);
  if (!names.length) return hhmm;
  if (names.length === 7) return `every day ${hhmm}`;
  return `${names.join(", ")} ${hhmm}`;
}

function outcomeOf(messages: DeliveryMessage[]): DeliveryOutcome | null {
  if (!messages.length) return null;
  const latest = [...messages].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0];
  if (!latest) return null;
  if (latest.body.includes(CHECKIN_NOTE_WINDOW)) return "window_closed";
  if (latest.body.includes(CHECKIN_NOTE_FAILED) || latest.sentOk === false) return "failed";
  return "sent";
}

export function summariseDelivery(input: {
  date: string;
  /** 0 = Sunday ... 6 = Saturday, South African local. */
  weekday: number;
  minuteOfDay: number;
  reminders: DeliveryReminder[];
  outbound: DeliveryMessage[];
  inbound: DeliveryMessage[];
}): DeliverySummary {
  const outBy = new Map<string, DeliveryMessage[]>();
  for (const row of input.outbound) {
    if (sastDate(row.at) !== input.date) continue;
    const list = outBy.get(row.clientId) ?? [];
    list.push(row);
    outBy.set(row.clientId, list);
  }
  const replied = new Set<string>();
  for (const row of input.inbound) {
    if (sastDate(row.at) === input.date) replied.add(row.clientId);
  }

  const summary: DeliverySummary = {
    date: input.date,
    due: 0,
    sent: 0,
    failed: 0,
    windowClosed: 0,
    waiting: 0,
    replied: 0,
    rows: [],
  };

  for (const reminder of input.reminders) {
    const due = reminderDueOnWeekday(reminder.days, input.weekday);
    if (!due) continue;
    summary.due += 1;
    const messages = outBy.get(reminder.clientId) ?? [];
    const fromSend = outcomeOf(messages);
    const past = input.minuteOfDay >= minutes(reminder.time);
    if (fromSend === "sent") summary.sent += 1;
    else if (fromSend === "failed") summary.failed += 1;
    else if (fromSend === "window_closed") summary.windowClosed += 1;
    else if (past) summary.waiting += 1;
    const didReply = replied.has(reminder.clientId);
    if (didReply) summary.replied += 1;
    summary.rows.push({
      name: reminder.name.trim() || "A patient",
      when: whenLabel(reminder.days, reminder.time),
      outcome: fromSend ?? (past ? "waiting" : "not_due"),
      replied: didReply,
    });
  }

  summary.rows.sort((a, b) => a.name.localeCompare(b.name));
  return summary;
}

export function formatDeliveryReply(summary: DeliverySummary): string {
  const lines = [
    `Check-ins ${summary.date}: ${summary.due} due, ${summary.sent} sent, ${summary.failed} failed, ${summary.windowClosed} window closed, ${summary.replied} replied.`,
  ];
  const problems = summary.rows.filter(
    (row) =>
      row.outcome === "failed" || row.outcome === "window_closed" || row.outcome === "waiting",
  );
  for (const row of problems.slice(0, 12)) {
    const word =
      row.outcome === "window_closed"
        ? "window closed"
        : row.outcome === "waiting"
          ? "not sent yet"
          : "failed";
    lines.push(`${row.name}: ${word} (${row.when})`);
  }
  if (problems.length > 12)
    lines.push(`And ${problems.length - 12} more on the admin check-in page.`);
  if (!problems.length && summary.due > 0) lines.push("Everyone who was due has a sent check-in.");
  return lines.join("\n");
}
