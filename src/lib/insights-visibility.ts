// Per-user, per-card visibility preferences for the practitioner insights page.
// Stored client-side in localStorage; no backend writes.

const KEY_PREFIX = "insights-hidden:";

export type InsightsCardId =
  | "kpi-active"
  | "kpi-checkins"
  | "kpi-pain"
  | "kpi-contacted"
  | "card-checkins"
  | "card-pain"
  | "card-progress"
  | "card-outreach"
  | "card-symptoms"
  | "card-movers";

export const INSIGHTS_CARD_LABELS: Record<InsightsCardId, string> = {
  "kpi-active": "Active clients",
  "kpi-checkins": "Check-ins (7d)",
  "kpi-pain": "Average pain",
  "kpi-contacted": "Contacted (7d)",
  "card-checkins": "Recent check-ins",
  "card-pain": "Average pain (6 weeks)",
  "card-progress": "Client progress",
  "card-outreach": "Outreach status",
  "card-symptoms": "Most prevalent symptoms",
  "card-movers": "Biggest movers",
};

export function loadHidden(userId: string | null): Set<InsightsCardId> {
  if (typeof window === "undefined") return new Set();
  const key = KEY_PREFIX + (userId ?? "anon");
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as InsightsCardId[]);
  } catch {
    return new Set();
  }
}

export function saveHidden(userId: string | null, hidden: Set<InsightsCardId>): void {
  if (typeof window === "undefined") return;
  const key = KEY_PREFIX + (userId ?? "anon");
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(hidden)));
  } catch {
    /* ignore quota */
  }
}
