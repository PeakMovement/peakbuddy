/**
 * The copy consent promises. Heidi session notes stay out until the consent
 * text names them. No interpretation is added.
 */

/** Flat JSON the client page can download. Nested values are stored as text. */
export type ExportRow = Record<string, string | number | boolean | null>;

function asRows(rows: unknown[]): ExportRow[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return { value: String(row ?? "") };
    const out: ExportRow = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value == null) out[key] = null;
      else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out[key] = value;
      } else {
        out[key] = JSON.stringify(value);
      }
    }
    return out;
  });
}

export interface ExportBundle {
  generatedAt: string;
  clients: ExportRow[];
  checkIns: ExportRow[];
  consents: ExportRow[];
  whatsappInbound: ExportRow[];
  whatsappOutbound: ExportRow[];
  wearableDays: ExportRow[];
  goals: Array<{ clientId: string; goal: string | null }>;
  exerciseMedia: ExportRow[];
  reception: ExportRow[];
  omitted: string[];
}

export function isDataCopyRequest(text: string): boolean {
  const n = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return false;
  return (
    /\bcopy of (my|what|the)\b/.test(n) ||
    /\b(my data|my information|my record|my records)\b/.test(n) ||
    /\bwhat (you|buddy) holds?\b/.test(n) ||
    /\b(export|download) my\b/.test(n) ||
    /\bpopia\b/.test(n) && /\b(copy|access|request|information)\b/.test(n)
  );
}

export const DATA_COPY_PATIENT =
  "I've asked the practice for a copy of what Buddy holds about you. They will check it, then send it. I have not added anything of my own.";

export function dataCopyConfirm(name: string): string {
  return `Prepare a copy of what Buddy holds for ${name}? You review it first. Nothing is sent until you confirm. Heidi notes are not included.`;
}

export function assembleExport(input: {
  generatedAt: string;
  clients: Array<Record<string, unknown>>;
  checkIns: unknown[];
  consents: unknown[];
  whatsappInbound: unknown[];
  whatsappOutbound: unknown[];
  wearableDays: unknown[];
  exerciseMedia: unknown[];
  reception: unknown[];
}): ExportBundle {
  return {
    generatedAt: input.generatedAt,
    clients: asRows(
      input.clients.map((c) => {
        const copy = { ...c };
        delete copy.login_code;
        delete copy.calendar_feed_token;
        return copy;
      }),
    ),
    checkIns: asRows(input.checkIns),
    consents: asRows(input.consents),
    whatsappInbound: asRows(input.whatsappInbound),
    whatsappOutbound: asRows(input.whatsappOutbound),
    wearableDays: asRows(input.wearableDays),
    goals: input.clients.map((c) => ({
      clientId: String(c.id ?? ""),
      goal: typeof c.goal === "string" ? c.goal : null,
    })),
    exerciseMedia: asRows(input.exerciseMedia),
    reception: asRows(input.reception),
    omitted: ["heidi_session_notes"],
  };
}

export function exportCounts(bundle: ExportBundle): string {
  return [
    `${bundle.checkIns.length} check-ins`,
    `${bundle.whatsappInbound.length} messages from them`,
    `${bundle.whatsappOutbound.length} messages from Buddy`,
    `${bundle.wearableDays.length} wearable days`,
    `${bundle.exerciseMedia.length} exercise files`,
    `${bundle.reception.length} reception notes`,
    "Heidi notes left out",
  ].join(", ");
}
