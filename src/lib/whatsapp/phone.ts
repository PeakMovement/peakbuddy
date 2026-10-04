/**
 * Phone numbers as the join key between a WhatsApp sender and a Buddy profile.
 *
 * WhatsApp hands us E.164 without the plus ("27827251107"). Practitioners type
 * whatever they like into clients.phone: "082 725 1107", "+27 82 725 1107",
 * "0827251107", "27-82-725-1107". All of those are the same person, and a
 * match that misses one of them is a patient whose answers silently go nowhere.
 *
 * South African numbers only get the 0 to +27 rewrite. Anything already
 * carrying a country code is left as it is.
 */

/** Digits only, South African local form rewritten to 27..., or null if unusable. */
export function toE164Digits(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = String(value)
    .replace(/^whatsapp:/i, "")
    .replace(/\D/g, "");
  if (!digits) return null;
  // International dialling prefix typed out in full.
  if (digits.startsWith("00")) digits = digits.slice(2);
  // South African local format: 0 followed by nine digits.
  if (digits.length === 10 && digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  // A South African number typed with the country code AND the trunk 0.
  if (digits.length === 12 && digits.startsWith("270")) digits = `27${digits.slice(3)}`;
  // Anything shorter than a real subscriber number is not something to match on.
  if (digits.length < 9) return null;
  return digits;
}

/** True when two numbers, however they were typed, are the same line. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = toE164Digits(a);
  const y = toE164Digits(b);
  return x !== null && x === y;
}

export interface PhoneCandidate {
  id: string;
  phone: string | null;
}

export type PhoneMatch =
  | { kind: "matched"; id: string }
  | { kind: "none" }
  /** Two or more profiles share the number. Never guess between them. */
  | { kind: "ambiguous"; ids: string[] };

export function matchPhone(sender: string, candidates: PhoneCandidate[]): PhoneMatch {
  const target = toE164Digits(sender);
  if (!target) return { kind: "none" };
  const ids = candidates.filter((c) => toE164Digits(c.phone) === target).map((c) => c.id);
  if (ids.length === 0) return { kind: "none" };
  if (ids.length > 1) return { kind: "ambiguous", ids };
  return { kind: "matched", id: ids[0] };
}

/** Last four digits only. The most of a number that may appear anywhere operational. */
export function maskPhone(value: string | null | undefined): string {
  const d = toE164Digits(value) ?? "";
  return d ? `…${d.slice(-4)}` : "unknown";
}
