/**
 * Open reception errands for the morning note and the owner overview.
 * Counts and the task the physio already wrote. Nothing here messages a patient.
 */
import { toSast } from "./clinic-hours";

export interface OpenErrand {
  request_text: string;
  created_at: string;
  sent_at: string | null;
  practitioner_id?: string | null;
}

export function errandAge(createdAt: string, now: Date): string {
  const then = toSast(new Date(createdAt)).date;
  const today = toSast(now).date;
  if (then === today) {
    const mins = Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 60_000));
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
  }
  const days = Math.max(1, Math.round((now.getTime() - new Date(createdAt).getTime()) / 86_400_000));
  if (days === 1) return "since yesterday";
  return `${days} days`;
}

function short(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}...` : t;
}

/**
 * "With reception" means reception has already been sent the errand.
 * "Saved" means sent_at is still empty.
 */
export function formatOpenErrands(rows: OpenErrand[], now: Date): string | null {
  const open = rows.filter((r) => r.request_text?.trim());
  if (!open.length) return null;
  const withReception = open.filter((r) => r.sent_at);
  const saved = open.filter((r) => !r.sent_at);
  const line = (row: OpenErrand) => `${short(row.request_text)} (${errandAge(row.created_at, now)})`;
  const parts: string[] = [];
  if (withReception.length) {
    parts.push(
      `${withReception.length} with reception since this morning: ${withReception.map(line).join("; ")}`,
    );
  }
  if (saved.length) {
    parts.push(
      `${saved.length} saved, reception has not had it yet: ${saved.map(line).join("; ")}`,
    );
  }
  return `Reception: ${parts.join(". ")}.`;
}
