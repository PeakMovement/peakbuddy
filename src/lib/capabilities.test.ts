import { describe, expect, it } from "vitest";
import { currentConsent } from "@/lib/consent/wording";
import {
  adherenceVersusCompliance,
  appointmentAnswer,
  bookingAsk,
  bookingTask,
  parseProgrammeDays,
  bookingTemplate,
  caseBrief,
  checkinFlowDefinition,
  deterministicTone,
  digestTeaser,
  movementLines,
  ownerScorecard,
  patternInsightDraft,
  patternPatientNudge,
  programmeAnswer,
  programmeReminderBody,
  programmeReminderDecision,
  quietNudgeDecision,
  recoveryComparison,
  riskBaselineLabel,
  shiftedReminderTime,
  wearableAssociationSentence,
  whoImproved,
} from "./capabilities";
import { RED_FLAG_LEXICON, RED_FLAG_LEXICON_LIVE, lexiconMatchesLive } from "./whatsapp/red-flag-lexicon";
import { runRedFlagRules } from "./whatsapp/red-flag-rules";
import { LIBRARY_COMING_SOON, EXERCISE_MEDIA_VISION, VOICE_NOTE_REPLIES, WHATSAPP_FLOW_CHECKIN, CASE_BRIEF_MODEL } from "./feature-flags";

describe("risk, patterns, wearables, recovery", () => {
  it("labels the risk score as a change from this patient's baseline", () => {
    const label = riskBaselineLabel({ score: 72, previous: 40, trend: "up" });
    expect(label.headline).toMatch(/own 30-day baseline/);
    expect(label.detail).toMatch(/Up 32/);
  });

  it("writes a pattern draft for the physio and does not nudge the patient without opt-in and confirm", () => {
    const draft = patternInsightDraft({
      clientName: "Sam K",
      dayOfWeek: 1,
      metric: "pain",
      direction: "high",
    });
    expect(draft.body).toMatch(/Monday/);
    expect(draft.body).toMatch(/not sent/);
    expect(
      patternPatientNudge({
        predictiveNudgesEnabled: false,
        featureEnabled: true,
        practitionerConfirmed: true,
      }),
    ).toBe("draft_only");
    expect(
      patternPatientNudge({
        predictiveNudgesEnabled: true,
        featureEnabled: true,
        practitionerConfirmed: false,
      }),
    ).toBe("await_confirm");
  });

  it("states wearable load next to pain as an association", () => {
    const line = wearableAssociationSentence({
      acuteChronicRatio: 1.5,
      sleepScore: 40,
      painNow: 7,
      painPrev: 4,
    });
    expect(line).toMatch(/Association only/);
    expect(line).not.toMatch(/caused|because/i);
  });

  it("shows a practice range and never says the patient is ahead or behind", () => {
    const result = recoveryComparison({
      complaint: "ACL",
      daysSinceStart: 20,
      painDrop: 2,
      peers: [
        { complaint: "ACL", days: 21, painDrop: 1 },
        { complaint: "ACL", days: 18, painDrop: 4 },
        { complaint: "ACL", days: 30, painDrop: 3 },
        { complaint: "neck", days: 20, painDrop: 9 },
      ],
    });
    expect(result?.sentence).toMatch(/ranged from 1 to 4/);
    expect(result?.sentence.toLowerCase()).not.toMatch(/ahead|behind/);
    expect(
      recoveryComparison({
        complaint: "ACL",
        daysSinceStart: 10,
        painDrop: 1,
        peers: [{ complaint: "ACL", days: 10, painDrop: 1 }],
      }),
    ).toBeNull();
  });
});

describe("owner scorecard, case brief, digest, adherence", () => {
  it("keeps the owner view to counts, initials, and complaint labels", () => {
    const card = ownerScorecard([
      { initials: "ZK", complaint: "ACL", daysSinceCheckIn: 2 },
      { initials: "ZK", complaint: "neck", daysSinceCheckIn: 12 },
      { initials: "AB", complaint: "ACL", daysSinceCheckIn: null },
    ]);
    expect(card.byPractitioner).toEqual([
      { initials: "ZK", active: 1, quiet: 1 },
      { initials: "AB", active: 0, quiet: 1 },
    ]);
    expect(card.dropOff.never).toBe(1);
    expect(JSON.stringify(card)).not.toMatch(/heidi|session note/i);
  });

  it("builds a practitioner-only brief and does not store Heidi in patient memory or send it to a model", () => {
    const brief = caseBrief({
      clientName: "Sam Kruger",
      heidiNote: "Knee irritable after the long run.",
      heidiDate: "2026-10-10",
      checkins: [
        { at: "2026-10-12", pain: 6, sleep: 3, energy: 3, stress: 4 },
        { at: "2026-10-08", pain: 4, sleep: 4, energy: 4, stress: 2 },
      ],
      wearable: { sleepScore: 55, loadRatio: 1.4 },
      goal: "Peninsula marathon",
    });
    expect(brief.storedInPatientMemory).toBe(false);
    expect(brief.sentToModel).toBe(false);
    expect(brief.text).toMatch(/Knee irritable/);
    expect(brief.text).toMatch(/Peninsula marathon/);
    expect(CASE_BRIEF_MODEL).toBe(false);
    expect(currentConsent("whatsapp_checkins").version).toBe("2026-10-07.1");
  });

  it("says who moved, and separates answering Buddy from doing the exercises", () => {
    expect(
      movementLines({
        name: "Sam",
        painThen: 6,
        painNow: 3,
        sleepThen: 4,
        sleepNow: 2,
        pattern: "Monday pain pattern is active.",
      }).join(" "),
    ).toMatch(/pain fell from 6 to 3/);
    const split = adherenceVersusCompliance({
      expectedCheckins: 4,
      answered: 3,
      adherence: ["all", null, "some"],
    });
    expect(split.compliancePct).toBe(75);
    expect(split.adherenceLabel).toMatch(/self-reported/i);
    expect(split.caveat).toMatch(/not counted as did not exercise/i);
  });

  it("puts names in the free-form digest and only a count in the template variables", () => {
    const teaser = digestTeaser({ firstName: "Zoe", attention: 2, names: ["Sam K", "Lee A"] });
    expect(teaser.variables).toEqual(["Zoe", "2"]);
    expect(teaser.freeform).toMatch(/Sam K/);
  });
});

describe("tone, reminder time, quiet nudge, programme", () => {
  it("uses name, practitioner, last pain, streak, and goal, and has no place for a complaint", () => {
    const line = deterministicTone({
      firstName: "Sam",
      practitionerFirstName: "Zoe",
      lastPain: 4,
      streak: 5,
      goal: "run in April",
    });
    expect(line).toMatch(/Zoe/);
    expect(line).toMatch(/pain was 4/);
    expect(line).toMatch(/run in April/);
    expect(line.toLowerCase()).not.toMatch(/heidi|session note|acl/);
  });

  it("shifts the reminder one hour toward when they reply, and only after three replies", () => {
    expect(
      shiftedReminderTime({ current: "18:00", replyHour: 6, replyMinute: 0, samplesAtThisHour: 2 }),
    ).toBeNull();
    expect(
      shiftedReminderTime({ current: "18:00", replyHour: 6, replyMinute: 0, samplesAtThisHour: 3 }),
    ).toBe("17:00");
  });

  it("tells the physio before a quiet patient is reminded, and caps the month", () => {
    expect(
      quietNudgeDecision({
        quietDays: 6,
        lastPhysioNotifiedOn: null,
        lastPatientSentOn: null,
        nudgesInWindow: 0,
        today: "2026-10-13",
        featureEnabled: true,
        practitionerConfirmed: false,
        windowOpen: true,
        reminderTemplateSet: true,
      }),
    ).toEqual({ tellPhysio: true, sendPatient: false, skipReason: null });
    expect(
      quietNudgeDecision({
        quietDays: 6,
        lastPhysioNotifiedOn: "2026-10-13",
        lastPatientSentOn: null,
        nudgesInWindow: 0,
        today: "2026-10-13",
        featureEnabled: true,
        practitionerConfirmed: true,
        windowOpen: false,
        reminderTemplateSet: false,
      }).skipReason,
    ).toBe("no_template");
    expect(
      quietNudgeDecision({
        quietDays: 6,
        lastPhysioNotifiedOn: null,
        lastPatientSentOn: null,
        nudgesInWindow: 3,
        today: "2026-10-13",
        featureEnabled: true,
        practitionerConfirmed: true,
        windowOpen: true,
        reminderTemplateSet: true,
      }).skipReason,
    ).toBe("monthly_cap");
  });

  it("sends the programme reminder only on the chosen days, after opt-in, and skips without a template", () => {
    expect(
      programmeReminderDecision({
        featureEnabled: true,
        optedIn: true,
        days: [1, 3],
        weekday: 1,
        lastSentOn: null,
        today: "2026-10-12",
        windowOpen: false,
        templateSet: false,
      }),
    ).toBe("skip");
    expect(
      programmeReminderDecision({
        featureEnabled: true,
        optedIn: true,
        days: [1],
        weekday: 1,
        lastSentOn: null,
        today: "2026-10-12",
        windowOpen: true,
        templateSet: false,
      }),
    ).toBe("send_text");
    const body = programmeReminderBody({
      firstName: "Sam",
      libraryLive: false,
      exerciseName: "Split squat",
      appLink: "https://example.test/library",
    });
    expect(body).toMatch(/programme your physio gave you/);
    expect(body).not.toMatch(/Split squat/);
    expect(
      programmeReminderBody({
        firstName: "Sam",
        libraryLive: true,
        exerciseName: "Split squat",
        appLink: "https://example.test/library",
      }),
    ).toMatch(/Split squat/);
  });
});

describe("booking, programme answers, flags that stay off", () => {
  it("confirms a booking in plain words and does not invent a slot", () => {
    const task = bookingTask("Sam", "move Thursday");
    expect(bookingAsk(task)).toMatch(/YES/);
    expect(task).toMatch(/Do not assume a free slot/);
    expect(bookingTemplate({ windowOpen: false, templateSet: false })).toBe("skip");
    expect(appointmentAnswer(null)).toMatch(/Reception keeps the diary/);
  });

  it("answers from the assigned exercise only, and not from a session note", () => {
    expect(
      programmeAnswer({
        assigned: "Split squat",
        libraryLive: !LIBRARY_COMING_SOON,
        libraryUrl: "https://example.test/library",
      }),
    ).toMatch(/Split squat/);
    expect(programmeAnswer({ assigned: null, libraryLive: false, libraryUrl: "https://example.test/library" })).toMatch(
      /Library/,
    );
  });

  it("reads the weekdays a physio named for a programme reminder", () => {
    expect(parseProgrammeDays("Mon, Wed and Friday")).toEqual([1, 3, 5]);
    expect(parseProgrammeDays("no days here")).toEqual([]);
  });

  it("lists who improved this week from the numbers", () => {
    expect(whoImproved([{ name: "Sam", painThen: 6, painNow: 3 }])).toMatch(/6 to 3/);
  });

  it("keeps the language scaffold, voice replies, vision, and the Flow off", () => {
    expect(RED_FLAG_LEXICON_LIVE).toBe(false);
    expect(lexiconMatchesLive("ubuhlungu besifuba")).toEqual([]);
    expect(RED_FLAG_LEXICON.map((e) => e.language).sort()).toEqual([
      "af",
      "af",
      "af",
      "af",
      "xh",
      "xh",
      "xh",
      "xh",
      "zu",
      "zu",
      "zu",
      "zu",
    ]);
    expect(RED_FLAG_LEXICON.every((e) => e.status === "clinician_review_required")).toBe(true);
    expect(runRedFlagRules({ text: "ubuhlungu besifuba" }).triggered).toBe(false);
    expect(VOICE_NOTE_REPLIES).toBe(false);
    expect(EXERCISE_MEDIA_VISION).toBe(false);
    expect(WHATSAPP_FLOW_CHECKIN).toBe(false);
    expect(checkinFlowDefinition().live).toBe(false);
  });
});
