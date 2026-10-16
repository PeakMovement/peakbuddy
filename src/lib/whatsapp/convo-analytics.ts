/**
 * Counts for the owner dashboard. Events store a code, never the patient's words.
 */

export interface ConvoEvent {
  kind: "understood" | "fallback" | "saved" | "deferred" | "dropoff";
  detail?: string | null;
}

export interface ConvoStats {
  events: number;
  understandingRate: number | null;
  fallbackRate: number | null;
  saves: number;
  deferred: number;
  avgTurnsPerSave: number | null;
  dropoff: Array<{ field: string; count: number }>;
}

export function summariseEvents(events: ConvoEvent[]): ConvoStats {
  const understood = events.filter((e) => e.kind === "understood").length;
  const fallback = events.filter((e) => e.kind === "fallback").length;
  const saved = events.filter((e) => e.kind === "saved").length;
  const deferred = events.filter((e) => e.kind === "deferred").length;
  const attempts = understood + fallback;
  const drops = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "dropoff") continue;
    const field = (e.detail ?? "unknown").slice(0, 40);
    drops.set(field, (drops.get(field) ?? 0) + 1);
  }
  return {
    events: events.length,
    understandingRate: attempts ? understood / attempts : null,
    fallbackRate: attempts ? fallback / attempts : null,
    saves: saved,
    deferred,
    avgTurnsPerSave: saved ? attempts / saved : null,
    dropoff: [...drops.entries()]
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count),
  };
}
