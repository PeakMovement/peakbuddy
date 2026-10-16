import { describe, expect, it } from "vitest";
import { answerCaseload } from "../caseload";
import { needsConfirm, readCheckinBubble } from "../checkin-read";
import { summariseEvents } from "../convo-analytics";
import { runDialogue } from "../dialogue";
import { contextFact, dueOutreach } from "../proactive-context";
import { addedNames } from "../practitioner-agent";
import {
  droppedName,
  followUpOf,
  handoverOf,
  phrasePractitioner,
  replacedName,
} from "../practitioner-talk";
import { fieldFromQuote, reactionReplyId } from "../reactions";
import { runRedFlagRules } from "../red-flag-rules";
import { EVAL_CASES, type ExtractCase, type TalkCase } from "./corpus";
import type { DecisionContext, InboundForDecision } from "../conversation";

function scoreExtract(row: ExtractCase): string | null {
  const read = readCheckinBubble(row.text, {
    pending: row.pending ?? null,
    replyId: row.replyId,
    quoted: row.quoted,
  });
  const problems: string[] = [];
  const check = (label: string, actual: unknown, expected: unknown) => {
    if (expected === undefined) return;
    if (actual !== expected) problems.push(`${label} ${String(actual)} != ${String(expected)}`);
  };
  check("pain", read.pain?.value ?? null, row.pain);
  check("sleep", read.sleep?.value ?? null, row.sleep);
  check("energy", read.energy?.value ?? null, row.energy);
  check("stress", read.stress?.value ?? null, row.stress);
  check("adherence", read.adherence?.value ?? null, row.adherence);
  check("confirm", needsConfirm(read), row.confirm);
  check("defer", read.defer?.when ?? null, row.defer);
  check("distress", read.distress, row.distress);
  check("aside", read.aside?.kind ?? null, row.aside);
  check("ambiguous", read.ambiguous, row.ambiguous);
  if (row.greeting !== undefined) {
    check("greeting", read.greeting || read.smallTalk, row.greeting);
  }
  check("correction", read.correction?.value ?? null, row.correction);
  return problems.length ? `${row.id} ${row.text}: ${problems.join("; ")}` : null;
}

function scoreTalk(row: TalkCase): string | null {
  const exp = row.expect;
  if (exp.fn === "replaced" && replacedName(row.text) !== exp.name) {
    return `${row.id} replaced ${replacedName(row.text)}`;
  }
  if (exp.fn === "dropped" && droppedName(row.text) !== exp.name) {
    return `${row.id} dropped ${droppedName(row.text)}`;
  }
  if (exp.fn === "added") {
    const got = addedNames(row.text);
    const same =
      (got == null && exp.names == null) ||
      (got != null && exp.names != null && got.join(",") === exp.names.join(","));
    if (!same) return `${row.id} added ${JSON.stringify(got)}`;
  }
  if (exp.fn === "follow" && followUpOf(row.text) !== exp.value) {
    return `${row.id} follow ${followUpOf(row.text)}`;
  }
  if (exp.fn === "handover") {
    const got = handoverOf(row.text);
    if (exp.action == null && got != null) return `${row.id} handover unexpected`;
    if (exp.action && (got?.action !== exp.action || got.name !== exp.name)) {
      return `${row.id} handover ${JSON.stringify(got)}`;
    }
  }
  if (exp.fn === "reaction" && reactionReplyId(row.text) !== exp.id) {
    return `${row.id} reaction ${reactionReplyId(row.text)}`;
  }
  if (exp.fn === "quote" && fieldFromQuote(row.text) !== exp.field) {
    return `${row.id} quote ${fieldFromQuote(row.text)}`;
  }
  return null;
}

const NOW = new Date("2026-10-05T08:00:00Z");

function patientCtx(text: string, over: Partial<DecisionContext> = {}): DecisionContext {
  const message: InboundForDecision = { text, replyId: undefined, kind: "text" };
  return {
    conversation: { state: "idle", draft: { notes: [] }, checkinStartedAt: null },
    client: { firstName: "Lolly" },
    hasConsent: true,
    checkedInToday: false,
    redFlags: runRedFlagRules({ text }),
    now: NOW,
    message,
    ...over,
  };
}

describe("conversation eval", () => {
  it("scores more than 100 hand written turns", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(100);
    const misses = EVAL_CASES.map((row) => (row.kind === "extract" ? scoreExtract(row) : scoreTalk(row))).filter(
      (row): row is string => Boolean(row),
    );
    expect(misses).toEqual([]);
  });

  it("confirms a free text bubble before saving, then saves on yes", () => {
    const first = runDialogue(
      patientCtx("pain about a 4, slept badly, energy low, did most of the exercises, stiff commute"),
    );
    expect(first?.saveCheckin).toBeUndefined();
    expect(first?.replies.some((r) => "body" in r && r.body.includes("pain 4"))).toBe(true);
    const saved = runDialogue(
      patientCtx("yes", {
        conversation: {
          state: "awaiting_notes",
          draft: { notes: ["stiff commute"], pain: 4, sleep: 2, energy: 2, adherence: "most", confirming: true },
          checkinStartedAt: NOW,
        },
      }),
    );
    expect(saved?.saveCheckin?.pain).toBe(4);
    expect(saved?.saveCheckin?.exerciseAdherence).toBe("most");
  });

  it("does not store a missed adherence tap as none", () => {
    const read = readCheckinBubble("pain 4");
    expect(read.adherence).toBeNull();
  });

  it("keeps a red flag on its own line", () => {
    const decision = runDialogue(patientCtx("I am not coping and my pain is 4"));
    expect(decision?.saveCheckin).toBeUndefined();
    expect(decision?.replies.map((r) => ("body" in r ? r.body : "")).join(" ")).not.toMatch(/I'll save/);
    expect(decision?.analytics?.detail).toBe("red_flag");
  });

  it("a thumbs up with nothing waiting does not invent a score", () => {
    const decision = runDialogue(
      patientCtx("", {
        message: { text: "", replyId: "react_yes", kind: "interactive" },
      }),
    );
    expect(decision?.saveCheckin).toBeUndefined();
    expect(decision?.replies[0]).toMatchObject({ body: "Okay." });
  });

  it("a quoted 4 answers the sleep question that was quoted", () => {
    const decision = runDialogue(
      patientCtx("4", {
        quotedText: "How did you sleep?",
        conversation: {
          state: "awaiting_sleep",
          draft: { notes: [], pain: 6 },
          checkinStartedAt: NOW,
        },
      }),
    );
    expect(decision?.next.draft.sleep).toBe(4);
    expect(decision?.saveCheckin).toBeUndefined();
  });

  it("later keeps the score already held", () => {
    const decision = runDialogue(
      patientCtx("later", {
        conversation: {
          state: "awaiting_sleep",
          draft: { notes: [], pain: 6 },
          checkinStartedAt: NOW,
        },
      }),
    );
    expect(decision?.next.draft.pain).toBe(6);
    expect(decision?.saveCheckin).toBeUndefined();
    expect(decision?.analytics?.kind).toBe("dropoff");
  });

  it("saves a partial row after 12 hours and leaves adherence blank", () => {
    const started = new Date(NOW.getTime() - 13 * 60 * 60 * 1000);
    const decision = runDialogue(
      patientCtx("hi", {
        conversation: {
          state: "awaiting_sleep",
          draft: { notes: [], pain: 5 },
          checkinStartedAt: started,
        },
      }),
    );
    expect(decision?.saveCheckin?.pain).toBe(5);
    expect(decision?.saveCheckin?.exerciseAdherence).toBeUndefined();
    expect(decision?.saveCheckin?.notes.startsWith("[partial]")).toBe(true);
  });

  it("answers a caseload question only from the rows it was given", () => {
    const text = answerCaseload("which ACL patients are improving", [
      { name: "A", complaint: "ACL", adherence: "all", pain: 3, previousPain: 6, sleep: 4, checkedInThisWeek: true },
      { name: "B", complaint: "back", adherence: "none", pain: 2, previousPain: 8, sleep: 2, checkedInThisWeek: false },
    ]);
    expect(text).toContain("A");
    expect(text).not.toContain("B");
    expect(answerCaseload("who hasn't done exercises this week", [])).toBe(
      "Nobody on your list matches that from the stored check ins.",
    );
  });

  it("caps outreach and prefers a flare over a day after note", () => {
    const now = new Date("2026-10-16T06:00:00Z");
    expect(
      dueOutreach({
        optIn: false,
        now,
        lastOutreachAt: null,
        sessionYesterday: true,
        flareYesterday: false,
        streak: 7,
        dischargedAt: null,
        alreadySent: [],
        windowOpen: true,
      }),
    ).toBeNull();
    expect(
      dueOutreach({
        optIn: true,
        now,
        lastOutreachAt: null,
        sessionYesterday: true,
        flareYesterday: true,
        streak: 0,
        dischargedAt: null,
        alreadySent: [],
        windowOpen: false,
      })?.kind,
    ).toBe("flare");
    expect(
      dueOutreach({
        optIn: true,
        now,
        lastOutreachAt: new Date("2026-10-14T06:00:00Z"),
        sessionYesterday: true,
        flareYesterday: true,
        streak: 14,
        dischargedAt: null,
        alreadySent: [],
        windowOpen: true,
      }),
    ).toBeNull();
  });

  it("a phraser cannot add a number or a send claim", () => {
    const stored = "Cayla Rosenblatt\nLast check-in: pain 4/10, sleep 3/5.\nChecks in on WhatsApp.";
    const short = phrasePractitioner("and her sleep?", stored);
    expect(short).toContain("4");
    expect(short).not.toMatch(/I've sent/);
    const invented = phrasePractitioner(
      "hoekom",
      "Pain on record is 4. The last note says the knee was stiff after sitting.",
    );
    expect(invented.startsWith("Hier is wat op rekord is.")).toBe(true);
    expect(invented).toContain("4");
    expect(invented).not.toMatch(/I've sent/);
  });

  it("counts understanding, fallback, turns and drop off without patient words", () => {
    const stats = summariseEvents([
      { kind: "understood" },
      { kind: "understood" },
      { kind: "fallback" },
      { kind: "saved" },
      { kind: "dropoff", detail: "sleep" },
      { kind: "dropoff", detail: "sleep" },
    ]);
    expect(stats.understandingRate).toBeCloseTo(2 / 3);
    expect(stats.fallbackRate).toBeCloseTo(1 / 3);
    expect(stats.avgTurnsPerSave).toBe(3);
    expect(stats.dropoff[0]).toEqual({ field: "sleep", count: 2 });
  });

  it("says nice only beside a stored drop of 2 or more", () => {
    expect(contextFact({ lastPain: 6, recentPain: 4 })).toContain("Nice");
    expect(contextFact({ lastPain: 6, recentPain: 5 })).toBe("Last time pain was 6.");
  });
});
