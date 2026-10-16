/**
 * Practitioner chat that stays on stored strings.
 * A correction never confirms a send. A phraser never adds a number.
 */

export interface StoredExplain {
  name: string;
  riskScore: number | null;
  summary: string | null;
  worse: string[];
  better: string[];
  lastPain: number | null;
  lastSleep: number | null;
  lastEnergy: number | null;
  lastStress: number | null;
  lastNote: string | null;
}

export function explainFromStored(row: StoredExplain): string {
  const bits: string[] = [];
  if (row.riskScore != null) bits.push(`Stored risk score ${row.riskScore}.`);
  if (row.worse.length) bits.push(`Marked worse on ${row.worse.join(" and ")} versus their own baseline.`);
  else if (row.summary?.trim()) bits.push(row.summary.trim());
  else bits.push("Nothing in the stored breakdown is marked worse.");
  if (row.better.length) bits.push(`Marked better on ${row.better.join(" and ")}.`);
  const last = [
    row.lastPain != null ? `pain ${row.lastPain}` : null,
    row.lastSleep != null ? `sleep ${row.lastSleep}` : null,
    row.lastEnergy != null ? `energy ${row.lastEnergy}` : null,
    row.lastStress != null ? `stress ${row.lastStress}` : null,
  ].filter(Boolean);
  if (last.length) bits.push(`Last check in: ${last.join(", ")}.`);
  if (row.lastNote?.trim()) {
    const note = row.lastNote.trim().slice(0, 160);
    bits.push(`Last note: "${note}"`);
  }
  if (!bits.length) return `I don't have a stored breakdown for ${row.name}.`;
  return `${row.name}: ${bits.join(" ")}`;
}

export type FollowUp = "why" | "sleep" | "energy" | "pain" | "stress" | "others" | "summary";

export function followUpOf(text: string): FollowUp | null {
  const n = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'?\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length > 80) return null;
  if (/^(why|why is (she|he|that) up|hoekom|hoe kom)(?:\?)?$/.test(n)) return "why";
  if (/^(and |what about )?(her|his|their) sleep(?:\?)?$/.test(n) || n === "sleep?") return "sleep";
  if (/^(and |what about )?(her|his|their) energy(?:\?)?$/.test(n)) return "energy";
  if (/^(and |what about )?(her|his|their) pain(?:\?)?$/.test(n)) return "pain";
  if (/^(and |what about )?(her|his|their) stress(?:\?)?$/.test(n)) return "stress";
  if (/^(what about the others|and the others|the rest of them)(?:\?)?$/.test(n)) return "others";
  if (/^(summarise|summarize|sum up|what did we just say|recap)(?:\?)?$/.test(n)) return "summary";
  return null;
}

/** "no I meant Lauren" replaces the pending name. It does not send. */
export function replacedName(text: string): string | null {
  const n = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = n.match(
    /^(?:no[, ]+)?(?:i |we )?(?:meant|mean|rather|it's|its)\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{2,30})?)$/,
  );
  if (!m) return null;
  const name = m[1].trim();
  if (/^(her|him|them|that|this|not|today|now)$/.test(name)) return null;
  return name;
}

/** "actually not her" or "not Lauren" drops a recipient. It does not send. */
export function droppedName(text: string): "pronoun" | string | null {
  const n = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = n.match(/^(?:no[, ]+)?(?:actually\s+)?not\s+(her|him|them|that one|[a-z][a-z'-]{2,30})$/);
  if (!m) return null;
  if (m[1] === "her" || m[1] === "him" || m[1] === "them" || m[1] === "that one") return "pronoun";
  if (/^(today|now|yet|sure)$/.test(m[1])) return null;
  return m[1];
}

const NUMBER_RE = /\d+(?:\.\d+)?/g;

/** Shorten a stored reply. Refuse the result if it adds a number or a send claim. */
export function phrasePractitioner(inbound: string, stored: string): string {
  const body = stored.trim();
  if (!body || body.length < 40) return body;
  const words = inbound.trim().split(/\s+/).filter(Boolean);
  const af = /\b(hoekom|asseblief|dankie|ja nee|gaan dit|haar|sy slaap)\b/i.test(inbound);
  let next = body;
  if (words.length > 0 && words.length <= 6) {
    const lines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !/^checks in on whatsapp/i.test(l) &&
          !/^uses the buddy app/i.test(l) &&
          !/^not on whatsapp or the buddy app yet/i.test(l),
      );
    if (lines.length) next = lines.join("\n");
  }
  if (af) next = `Hier is wat op rekord is.\n${next}`;
  const allowed = new Set(body.match(NUMBER_RE) ?? []);
  const used = next.match(NUMBER_RE) ?? [];
  if (used.some((n) => !allowed.has(n))) return body;
  if (/\b(i've sent|i have sent|message sent|diagnos)\b/i.test(next) && !/\b(i've sent|i have sent)\b/i.test(body)) {
    return body;
  }
  return next;
}

export function summariseThread(turns: Array<{ role: string; text: string }>): string {
  const rows = turns
    .map((t) => `${t.role === "buddy" ? "Buddy" : "You"}: ${t.text.replace(/\s+/g, " ").trim()}`)
    .filter((t) => t.length > 6)
    .slice(-6);
  if (!rows.length) return "Nothing stored from this stretch of the chat.";
  return `This stretch:\n${rows.join("\n")}`;
}

/** "I'll take Lauren" pauses Buddy. "Hand Lauren back" resumes. It does not send. */
export function handoverOf(
  text: string,
): { action: "pause_buddy" | "resume_buddy"; name: string } | null {
  const n = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const resume = n.match(
    /^(?:resume buddy(?: for)?|hand back|buddy can take|give it back to buddy)(?:\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{2,30})?))?$/,
  );
  if (resume) {
    const name = resume[1]?.trim();
    return name ? { action: "resume_buddy", name } : null;
  }
  const namedBack = n.match(/^hand ([a-z][a-z'-]{1,30}) back$/);
  if (namedBack) return { action: "resume_buddy", name: namedBack[1] };
  const pause = n.match(
    /^(?:pause buddy(?: for)?|i'll take|i will take|jump in(?: with)?|i'm taking|im taking)(?:\s+over)?(?:\s+with)?\s+([a-z][a-z'-]{1,30}(?:\s+[a-z][a-z'-]{2,30})?)$/,
  );
  if (!pause) return null;
  return { action: "pause_buddy", name: pause[1].trim() };
}

export function sliceStored(follow: FollowUp, stored: string): string {
  if (follow === "why" || follow === "summary" || follow === "others") return stored;
  const line = stored
    .split("\n")
    .find((l) => new RegExp(follow, "i").test(l));
  return line?.trim() || stored;
}
