const KEY = "buddy.client_id";

export function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function setClientId(id: string) {
  window.localStorage.setItem(KEY, id);
}

export function clearClientId() {
  window.localStorage.removeItem(KEY);
}

export function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export const RED_FLAG_TERMS_CHECKIN = [
  "chest pain",
  "can't breathe",
  "cant breathe",
  "numbness",
  "paralysis",
  "stroke",
  "collapsed",
  "unconscious",
];

export const RED_FLAG_TERMS_YVES = [
  "chest pain",
  "heart",
  "can't breathe",
  "cant breathe",
  "stroke",
  "paralysis",
  "numbness in face",
  "unconscious",
  "collapsed",
  "suicidal",
  "severe headache",
  "sudden blurred vision",
];

export function containsRedFlag(text: string, terms: string[]): boolean {
  const t = text.toLowerCase();
  return terms.some((term) => t.includes(term));
}
