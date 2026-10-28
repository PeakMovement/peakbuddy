/**
 * Outcome scores on WhatsApp (28 Oct 2026, Justin: NPRS and PSFS at intake,
 * every 2 weeks, and discharge).
 *
 * Offered at the end of a normal check-in, never in the middle of one. The
 * patient can say "later" at any point and nothing is saved. Pure: the
 * worker stores the step in the conversation draft and saves the result.
 */

export type OutcomeTimepoint = "intake" | "followup" | "discharge";

export interface OutcomeDraft {
  step: "offer" | "nprs" | "psfs_names" | "psfs_rate";
  timepoint: OutcomeTimepoint;
  nprs?: number;
  activities?: string[];
  scores?: number[];
  /** When the offer was made, so a stale one lapses. */
  at: string;
}

export interface OutcomeResult {
  nprs: number;
  psfs: { activity: string; score: number }[];
  timepoint: OutcomeTimepoint;
}

type Reply =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Array<{ id: string; title: string }> }
  | {
      kind: "list";
      body: string;
      buttonLabel: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    };

export const OUTCOME_IDS = {
  yes: "oc_yes",
  later: "oc_later",
  score: (n: number) => `oc_n_${n}`,
};

/** Every 2 weeks. */
export const OUTCOME_EVERY_DAYS = 14;
/** An unanswered offer or half-done set lapses after this. */
export const OUTCOME_LAPSE_MS = 24 * 3600_000;

const scoreList = (body: string): Reply => ({
  kind: "list",
  body: `${body}\n\nTap a number, or type 10.`,
  buttonLabel: "Choose 0 to 9",
  rows: Array.from({ length: 10 }, (_, n) => ({
    id: OUTCOME_IDS.score(n),
    title: String(n),
    description: n === 0 ? "Lowest" : n === 9 ? "Type 10 for the top" : undefined,
  })),
});

export function outcomeOffer(timepoint: OutcomeTimepoint): Reply {
  const lead =
    timepoint === "intake"
      ? "One more thing, just this once and then every two weeks: two quick questions so your physio can measure your progress properly."
      : timepoint === "discharge"
        ? "Before you finish with the practice, two quick questions so your physio can see how far you've come."
        : "It's been two weeks, so here are the two quick progress questions for your physio.";
  return {
    kind: "buttons",
    body: `${lead} Got a minute now?`,
    buttons: [
      { id: OUTCOME_IDS.yes, title: "Yes, go" },
      { id: OUTCOME_IDS.later, title: "Later" },
    ],
  };
}

const NPRS_Q = scoreList(
  "Over the last week, on average, how bad has your pain been? 0 is no pain, 10 is the worst you can imagine.",
);
const NAMES_Q: Reply = {
  kind: "text",
  body: "Name up to 3 everyday things your injury makes hard right now, like climbing stairs, running or picking up your child. Send them in one message.",
};
const rateQ = (activity: string): Reply =>
  scoreList(
    `How well can you manage "${activity}" right now? 0 means you can't do it at all, 10 means as well as before the injury.`,
  );

export function readScore(text: string, replyId?: string | null): number | null {
  const id = replyId?.match(/^oc_n_(\d{1,2})$/);
  if (id) return Number(id[1]);
  const m = String(text ?? "")
    .trim()
    .match(
      /^(?:about|around|maybe|probably|like|so)?\s*(10|[0-9])(?:\s*\/\s*10|\s*out of 10)?[.!]*$/i,
    );
  return m ? Number(m[1]) : null;
}

/** "stairs, running and lifting my son" -> three activities. */
export function readActivities(text: string): string[] {
  const clean = (s: string) =>
    s
      .replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "")
      .replace(/^(?:also|and|plus)\s+/i, "")
      .trim()
      .replace(/[.!]+$/, "");
  let parts = String(text ?? "")
    .split(/\n|,|;|&|\+/)
    .map(clean)
    .filter(Boolean);
  // "stairs and running": only split on "and" when nothing else separated them.
  if (parts.length === 1) parts = parts[0].split(/\s+and\s+/i).map(clean);
  return parts.filter((s) => s.length >= 3 && s.length <= 60).slice(0, 3);
}

const LATER = /^(later|not now|no|nope|skip|maybe later|another time|nee|later asseblief)[.!]*$/i;

export interface OutcomeStep {
  replies: Reply[];
  /** The draft to keep, or null when finished or put off. */
  next: OutcomeDraft | null;
  /** Set when the last answer came in. */
  result?: OutcomeResult;
}

/**
 * One patient message while an outcome set is open. Returns null when the
 * message isn't part of it (the normal conversation takes it, and the set
 * is dropped).
 */
export function outcomeStep(
  draft: OutcomeDraft,
  text: string,
  replyId: string | null | undefined,
  previousActivities: string[],
): OutcomeStep | null {
  const t = String(text ?? "").trim();
  if (replyId === OUTCOME_IDS.later || (!replyId && LATER.test(t))) {
    return {
      replies: [{ kind: "text", body: "No problem. I'll ask again after your next check-in." }],
      next: null,
    };
  }
  if (draft.step === "offer") {
    if (replyId === OUTCOME_IDS.yes || /^(yes|yep|ok|okay|sure|go|ja|yebo|ewe)\b/i.test(t)) {
      return { replies: [NPRS_Q], next: { ...draft, step: "nprs" } };
    }
    return null;
  }
  if (draft.step === "nprs") {
    const n = readScore(t, replyId);
    if (n === null)
      return {
        replies: [{ kind: "text", body: "Just a number from 0 to 10, please." }, NPRS_Q],
        next: draft,
      };
    const acts = previousActivities.slice(0, 3);
    if (acts.length) {
      return {
        replies: [rateQ(acts[0])],
        next: { ...draft, step: "psfs_rate", nprs: n, activities: acts, scores: [] },
      };
    }
    return { replies: [NAMES_Q], next: { ...draft, step: "psfs_names", nprs: n } };
  }
  if (draft.step === "psfs_names") {
    const acts = readActivities(t);
    if (!acts.length) return { replies: [NAMES_Q], next: draft };
    return {
      replies: [rateQ(acts[0])],
      next: { ...draft, step: "psfs_rate", activities: acts, scores: [] },
    };
  }
  // psfs_rate
  const acts = draft.activities ?? [];
  const scores = draft.scores ?? [];
  const n = readScore(t, replyId);
  if (n === null) {
    return {
      replies: [
        { kind: "text", body: "Just a number from 0 to 10, please." },
        rateQ(acts[scores.length]),
      ],
      next: draft,
    };
  }
  const done = [...scores, n];
  if (done.length < acts.length) {
    return { replies: [rateQ(acts[done.length])], next: { ...draft, scores: done } };
  }
  return {
    replies: [
      {
        kind: "text",
        body: "Thanks, that's saved for your physio. I'll ask these again in two weeks.",
      },
    ],
    next: null,
    result: {
      nprs: draft.nprs ?? 0,
      psfs: acts.map((activity, i) => ({ activity, score: done[i] })),
      timepoint: draft.timepoint,
    },
  };
}

export function psfsMean(items: Array<{ score: number }>): number {
  if (!items.length) return 0;
  return Math.round((items.reduce((n, i) => n + i.score, 0) / items.length) * 10) / 10;
}

/** "NPRS 6 → 3, PSFS 3.0 → 6.7 since 14 Oct" for the practitioner. */
export function outcomeSummary(
  rows: Array<{ measure: string; score: number; created_at: string }>,
): string | null {
  const line = (m: "nprs" | "psfs") => {
    const r = rows
      .filter((x) => x.measure === m)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!r.length) return null;
    const f = (v: number) => (m === "psfs" ? Number(v).toFixed(1) : String(Math.round(Number(v))));
    const first = r[0];
    const last = r[r.length - 1];
    if (r.length === 1) return `${m.toUpperCase()} ${f(first.score)}`;
    return `${m.toUpperCase()} ${f(first.score)} → ${f(last.score)}`;
  };
  const parts = [line("nprs"), line("psfs")].filter(Boolean);
  if (!parts.length) return null;
  const since = rows.map((r) => r.created_at).sort()[0];
  const day = new Date(since).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  });
  return `${parts.join(", ")} (since ${day})`;
}
