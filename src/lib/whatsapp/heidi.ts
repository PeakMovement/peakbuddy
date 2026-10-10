/**
 * Pure Heidi helpers. No env, no fetch, no logging.
 *
 * Heidi's Open API has no call that lists one patient's sessions or documents.
 * Sessions are addressed by id (GET /sessions/{id}). Documents, context
 * documents and transcripts are the same. Postman documents
 * GET /sessions/linked-user, which lists the linked user's sessions, and those
 * rows can carry ehr_patient_id. This module only keeps a row when that id
 * (or a stored patient profile id) matches. Rows with no patient identifier
 * are ignored. POST /sessions and POST /consult-note create records, so they
 * are not used here.
 */

export interface HeidiPatient {
  id: string;
  full_name: string | null;
}

export type HeidiCommand = { kind: "pick"; clientId: string } | { kind: "ask"; name: string };

const PICK = /^heidi_([0-9a-f-]{36})$/i;

/** Practitioner phrases that ask Buddy to read a client's Heidi record. */
export function readHeidiCommand(text: string, replyId: string | null): HeidiCommand | null {
  const picked = replyId?.match(PICK)?.[1];
  if (picked) return { kind: "pick", clientId: picked };
  const t = String(text ?? "").trim();
  if (!t) return null;
  const patterns = [
    /^(?:please\s+)?(?:get|fetch|pull|show|read)\s+(.+?)\s+from\s+heidi[.!?]?$/i,
    /^what does heidi say about\s+(.+?)[?.!]?$/i,
    /^(?:please\s+)?(?:get|fetch|pull|show|read)\s+(.+?)(?:'s|’s)\s+(?:files?|records?|notes?|documents?)(?:\s+from\s+heidi)?[.!?]?$/i,
    /^(?:please\s+)?(?:get|fetch|pull|show|read)\s+(?:the\s+)?(?:files?|records?|notes?|documents?)\s+(?:for|on|about)\s+(.+?)(?:\s+from\s+heidi)?[.!?]?$/i,
    /^heidi\s+(?:files?|notes?|records?|documents?)\s+(?:for|on|about)\s+(.+?)[?.!]?$/i,
  ];
  for (const p of patterns) {
    const name = t.match(p)?.[1]?.trim();
    if (name) return { kind: "ask", name };
  }
  return null;
}

/**
 * Full name, or first and last name. A first name on its own is never enough
 * to call Heidi.
 */
export function heidiPatientMatches(text: string, patients: HeidiPatient[]): HeidiPatient[] {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .split(/[^\p{L}'-]+/u)
      .filter(Boolean),
  );
  const lower = text.toLowerCase();
  const scored = patients
    .map((p) => {
      const parts = String(p.full_name ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2);
      if (parts.length < 2) return { p, score: 0 };
      const first = parts[0];
      const last = parts[parts.length - 1];
      let score = 0;
      if (lower.includes(parts.join(" "))) score = 3;
      else if (words.has(first) && words.has(last)) score = 2;
      return { p, score };
    })
    .filter((x) => x.score > 0);
  const best = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === best).map((x) => x.p);
}

export interface HeidiProfileName {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
}

/** One profile whose first and last name equal the client's. Otherwise none. */
export function uniqueProfileByName(
  profiles: HeidiProfileName[],
  fullName: string,
): string | null {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0].toLowerCase();
  const last = parts[parts.length - 1].toLowerCase();
  const hits = profiles.filter(
    (p) =>
      String(p.first_name ?? "")
        .trim()
        .toLowerCase() === first &&
      String(p.last_name ?? "")
        .trim()
        .toLowerCase() === last &&
      p.id,
  );
  return hits.length === 1 ? hits[0].id : null;
}

export type SessionVerdict = "match" | "other" | "unknown";

export function sessionPatientVerdict(
  session: unknown,
  clientId: string,
  profileId: string | null,
): SessionVerdict {
  if (!session || typeof session !== "object") return "unknown";
  const row = session as Record<string, unknown>;
  const ehr = typeof row.ehr_patient_id === "string" ? row.ehr_patient_id : "";
  const profile =
    row.patient_profile && typeof row.patient_profile === "object"
      ? (row.patient_profile as Record<string, unknown>)
      : null;
  const profileEhr = typeof profile?.ehr_patient_id === "string" ? profile.ehr_patient_id : "";
  const profileRowId = typeof profile?.id === "string" ? profile.id : "";
  if (ehr) return ehr === clientId ? "match" : "other";
  if (profileEhr) return profileEhr === clientId ? "match" : "other";
  if (profileRowId && profileId) return profileRowId === profileId ? "match" : "other";
  return "unknown";
}

export interface LinkedSessionRef {
  id: string;
  at: string | null;
}

/**
 * Sessions from GET /sessions/linked-user. usable is false when no row carried
 * a patient identifier, so the caller must not treat the list as this client.
 */
export function selectLinkedSessions(
  sessions: unknown[],
  clientId: string,
  profileId: string | null,
): { usable: boolean; ids: LinkedSessionRef[] } {
  let usable = false;
  const ids: LinkedSessionRef[] = [];
  for (const session of sessions) {
    const verdict = sessionPatientVerdict(session, clientId, profileId);
    if (verdict === "unknown") continue;
    usable = true;
    if (verdict !== "match" || !session || typeof session !== "object") continue;
    const row = session as Record<string, unknown>;
    const id = typeof row.session_id === "string" ? row.session_id : typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const at =
      typeof row.created_at === "string"
        ? row.created_at
        : typeof row.updated_at === "string"
          ? row.updated_at
          : null;
    ids.push({ id, at });
  }
  return { usable, ids };
}

export const HEIDI_REPLY_CAP = 1200;
export const HEIDI_STORE_CAP = 4000;

export interface HeidiDigestDoc {
  name: string;
  content: string | null;
}

export interface HeidiSessionDigest {
  id: string;
  at: string | null;
  note: string | null;
  transcript: string | null;
  documents: HeidiDigestDoc[];
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) : flat;
}

/** Short text for WhatsApp, and a longer copy for the server-side record. */
export function buildHeidiSummary(sessions: HeidiSessionDigest[]): {
  reply: string;
  stored: string;
  newest: string | null;
} {
  const parts: string[] = [];
  let newest: string | null = null;
  for (const session of sessions) {
    if (session.at && (!newest || session.at > newest)) newest = session.at;
    const bits: string[] = [];
    if (session.note?.trim()) bits.push(clip(session.note, HEIDI_STORE_CAP));
    if (session.transcript?.trim()) bits.push(`Transcript: ${clip(session.transcript, HEIDI_STORE_CAP)}`);
    for (const doc of session.documents) {
      const name = doc.name.trim() || "Unnamed file";
      if (doc.content?.trim()) bits.push(`${name}: ${clip(doc.content, HEIDI_STORE_CAP)}`);
      else bits.push(`${name}: the text was not in the API response`);
    }
    if (bits.length) parts.push(bits.join(" "));
  }
  const stored = clip(parts.join(" "), HEIDI_STORE_CAP);
  return { reply: stored.slice(0, HEIDI_REPLY_CAP), stored, newest };
}

export function heidiLinkUrl(region: string, jwt: string): string {
  const q = new URLSearchParams({
    reset: "true",
    region: region.toUpperCase(),
    productName: "Buddy",
    t: jwt,
  });
  return `https://scribe.heidihealth.com/integration/widget/auth?${q.toString()}`;
}

export function heidiNoteDate(iso: string | null): string {
  if (!iso) return "undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "undated";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  }).format(d);
}

export const HEIDI_MSG = {
  helpLine: `• "Get Sam Kruger's files" and I'll read that client's Heidi notes`,
  needFullName: (name: string) =>
    `I need the client's first and last name before I look in Heidi, ${name}.`,
  which: "I found more than one client with that name. Which one did you mean?",
  notOnList: (name: string) =>
    `I couldn't find that client on your list, ${name}. Try their first and last name.`,
  notInHeidi: (client: string) => `I couldn't find ${client} in your Heidi account.`,
  noEmail: "Your Buddy login has no email, so I can't open your Heidi account.",
  unreachable: "I couldn't reach Heidi just now. Please try again in a minute.",
  rejected: "Heidi didn't accept the connection. Check the Heidi key in Buddy.",
  nothingToRead: (client: string) =>
    `I found ${client} in Heidi, but there is no session I can read. Heidi does not offer a list of one patient's sessions or documents, so Buddy can only open session ids it has already stored for this client.`,
  readyInApp: (client: string) => `${client}'s Heidi summary is ready in Buddy.`,
  summary: (client: string, date: string, text: string) => `${client}\nNewest note: ${date}\n${text}`,
};
