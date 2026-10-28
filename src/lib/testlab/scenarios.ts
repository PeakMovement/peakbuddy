/**
 * Test Lab scenarios: scripted conversations with pass/fail checks.
 * Each runs on a fresh copy of the sandbox practice. Checks look at what
 * Buddy saved and sent, never at exact wording, so a better-worded reply
 * still passes.
 *
 * `feature` marks behaviour that is still being built; those may fail until
 * it ships, and the Lab shows them separately.
 */
import type { LabJump, LabLine, LabState } from "./engine.server";
import { LAB_PEOPLE } from "./seed";

export type ScenarioStep =
  | { send: { from: string; text: string } }
  | { tap: { from: string; title: RegExp } }
  | { advance: LabJump };

export interface ScenarioCheck {
  label: string;
  pass: (ctx: { state: LabState; lines: LabLine[] }) => boolean;
}

export interface Scenario {
  id: string;
  area: "Patient" | "Practitioner" | "Schedule" | "Safety" | "Admin";
  title: string;
  why: string;
  feature?: string;
  steps: ScenarioStep[];
  checks: ScenarioCheck[];
}

/* helpers ------------------------------------------------------------ */

const clientOf = (state: LabState, key: string) => {
  const phone = LAB_PEOPLE.find((p) => p.key === key)?.phone;
  return (state.tables.clients ?? []).find((c) => String(c.phone_e164 ?? c.phone) === phone);
};
const reminderOf = (state: LabState, key: string) => {
  const c = clientOf(state, key);
  return c ? (state.tables.checkin_reminders ?? []).find((r) => r.client_id === c.id) : undefined;
};
const checkinsOf = (state: LabState, key: string) => {
  const c = clientOf(state, key);
  return c ? (state.tables.check_ins ?? []).filter((r) => r.client_id === c.id) : [];
};
const newestCheckin = (state: LabState, key: string) =>
  [...checkinsOf(state, key)].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  )[0];
const sentTo = (lines: LabLine[], key: string) =>
  lines.filter((l) => l.dir === "out" && l.who === key);
const textTo = (lines: LabLine[], key: string) =>
  sentTo(lines, key)
    .map((l) => l.text)
    .join("\n");
const SEED_SAM_CHECKINS = 8;

/* scenarios ---------------------------------------------------------- */

export const SCENARIOS: Scenario[] = [
  {
    id: "checkin-step-by-step",
    area: "Patient",
    title: "A normal check-in, one answer at a time",
    why: "The bread and butter. Buddy should walk Sam through and save one check-in.",
    steps: [
      { send: { from: "sam", text: "hi" } },
      { send: { from: "sam", text: "3" } },
      { send: { from: "sam", text: "slept well" } },
      { send: { from: "sam", text: "4" } },
      { send: { from: "sam", text: "low" } },
      { send: { from: "sam", text: "did all of them" } },
      { send: { from: "sam", text: "knee felt good on the stairs" } },
    ],
    checks: [
      {
        label: "Buddy replied to every message",
        pass: ({ lines }) => sentTo(lines, "sam").length >= 5,
      },
      {
        label: "A new check-in was saved",
        pass: ({ state }) => checkinsOf(state, "sam").length === SEED_SAM_CHECKINS + 1,
      },
      {
        label: "Pain saved as 3",
        pass: ({ state }) => newestCheckin(state, "sam")?.pain_level === 3,
      },
    ],
  },
  {
    id: "checkin-one-message",
    area: "Patient",
    title: "Everything in one message",
    why: "Patients often answer it all at once. Buddy should read it, not ask again from scratch.",
    steps: [
      { send: { from: "sam", text: "hi" } },
      { send: { from: "sam", text: "pain about a 2 today, slept badly, energy is ok" } },
    ],
    checks: [
      {
        label: "Pain 2 was understood (saved, or held to confirm)",
        pass: ({ state, lines }) =>
          newestCheckin(state, "sam")?.pain_level === 2 || /\b2\b/.test(textTo(lines, "sam")),
      },
      {
        label: "Buddy did not ask for pain again",
        pass: ({ lines }) =>
          !/how is your pain|pain right now/i.test(sentTo(lines, "sam").at(-1)?.text ?? ""),
      },
    ],
  },
  {
    id: "schedule-once-a-week",
    area: "Schedule",
    title: '"Only check in once a week"',
    why: "The bug a client reported: asked for weekly, still got daily.",
    steps: [
      { send: { from: "sam", text: "can you only check in with me every once in a week please" } },
    ],
    checks: [
      {
        label: "Reminder now runs on one day a week",
        pass: ({ state }) => (reminderOf(state, "sam")?.days_of_week ?? []).length === 1,
      },
      {
        label: "Buddy confirmed the new schedule",
        pass: ({ lines }) => /week|monday|mon\b/i.test(textTo(lines, "sam")),
      },
    ],
  },
  {
    id: "schedule-two-days",
    area: "Schedule",
    title: '"Mondays and Thursdays please"',
    why: "Named days should be saved exactly.",
    steps: [{ send: { from: "sam", text: "please only check in on mondays and thursdays" } }],
    checks: [
      {
        label: "Reminder days are Monday and Thursday",
        pass: ({ state }) =>
          JSON.stringify([...(reminderOf(state, "sam")?.days_of_week ?? [])].sort()) === "[1,4]",
      },
    ],
  },
  {
    id: "schedule-time",
    area: "Schedule",
    title: '"Remind me at 7pm instead"',
    why: "A shift worker shouldn't be pinged at the default time.",
    feature: "Reminder at the patient's chosen time",
    steps: [{ send: { from: "sam", text: "can you remind me at 7pm instead" } }],
    checks: [
      {
        label: "Reminder time saved as 19:00",
        pass: ({ state }) =>
          String(reminderOf(state, "sam")?.time_of_day ?? "").startsWith("19:00"),
      },
      {
        label: "Buddy confirmed the time",
        pass: ({ lines }) => /7\s?pm|19:00/i.test(textTo(lines, "sam")),
      },
    ],
  },
  {
    id: "schedule-time-loose",
    area: "Schedule",
    title: '"Message me in the evenings around 8"',
    why: "People don't say 20:00. Buddy should still get the time.",
    steps: [{ send: { from: "sam", text: "can you message me in the evenings around 8" } }],
    checks: [
      {
        label: "Reminder time saved as 20:00",
        pass: ({ state }) =>
          String(reminderOf(state, "sam")?.time_of_day ?? "").startsWith("20:00"),
      },
    ],
  },
  {
    id: "language-switch",
    area: "Patient",
    title: '"Kan jy in Afrikaans praat?"',
    why: "Asking for Afrikaans should stick for the rest of the chat.",
    feature: "Replies in the patient's language",
    steps: [
      { send: { from: "sam", text: "kan jy asseblief in Afrikaans praat" } },
      { send: { from: "sam", text: "hi" } },
    ],
    checks: [
      {
        label: "Language saved as Afrikaans",
        pass: ({ state }) => clientOf(state, "sam")?.preferred_language === "af",
      },
      {
        label: "The next reply is in Afrikaans",
        pass: ({ lines }) =>
          /\b(jou|jy|hoe|pyn|vandag)\b/i.test(sentTo(lines, "sam").at(-1)?.text ?? ""),
      },
    ],
  },
  {
    id: "progress-note",
    area: "Patient",
    title: "Weekly look back after a check-in",
    why: "Sam has improved from 6 to 2. After today's check-in Buddy should tell him.",
    steps: [
      { send: { from: "sam", text: "hi" } },
      { send: { from: "sam", text: "pain 1, slept 4, energy 4, stress 1, did all my exercises" } },
    ],
    checks: [
      {
        label: "Sam got a look back with his numbers",
        pass: ({ lines }) => /look back|gone from|progress/i.test(textTo(lines, "sam")),
      },
    ],
  },
  {
    id: "afrikaans-pain",
    area: "Patient",
    title: "Afrikaans check-in",
    why: "Pieter writes in Afrikaans. Buddy should still read the number.",
    steps: [
      { send: { from: "pieter", text: "hallo" } },
      { send: { from: "pieter", text: "my skouer is vandag baie seer, so 7" } },
    ],
    checks: [
      {
        label: "Pain 7 was understood",
        pass: ({ state, lines }) =>
          newestCheckin(state, "pieter")?.pain_level === 7 || /\b7\b/.test(textTo(lines, "pieter")),
      },
    ],
  },
  {
    id: "afrikaans-reply",
    area: "Patient",
    title: "Buddy answers in Afrikaans",
    why: "If someone writes in Afrikaans, Buddy should answer in Afrikaans.",
    feature: "Replies in the patient's language",
    steps: [{ send: { from: "pieter", text: "hallo, hoe werk hierdie?" } }],
    checks: [
      {
        label: "The reply is in Afrikaans",
        pass: ({ lines }) => {
          const t = textTo(lines, "pieter");
          return (
            /\b(jou|jy|hoe gaan|pyn|dankie|asseblief|vandag)\b/i.test(t) &&
            !/\b(how's|your pain|thanks)\b/i.test(t)
          );
        },
      },
    ],
  },
  {
    id: "red-flag",
    area: "Safety",
    title: "Red flag words",
    why: "Numbness and bladder changes must raise an alert and reach the practice straight away.",
    steps: [
      { send: { from: "lerato", text: "my legs are going numb and i can't control my bladder" } },
    ],
    checks: [
      {
        label: "An alert was raised",
        pass: ({ state }) => {
          const c = clientOf(state, "lerato");
          return (state.tables.alerts ?? []).some((a) => a.client_id === c?.id);
        },
      },
      {
        label: "The practice was notified (push, email or WhatsApp alert)",
        pass: ({ lines }) =>
          lines.some((l) => l.dir === "event" || l.who === "physio" || l.who === "owner"),
      },
      {
        label: "Lerato was told to get urgent help",
        pass: ({ lines }) =>
          /urgent|emergency|10177|hospital|call|phone/i.test(textTo(lines, "lerato")),
      },
    ],
  },
  {
    id: "red-flag-escalation",
    area: "Safety",
    title: "Red flag nobody opens for 2 hours",
    why: "If the physio doesn't open a red flag, the practice owner hears about it.",
    steps: [
      { send: { from: "lerato", text: "my legs are going numb and i can't control my bladder" } },
      { advance: "2h" },
    ],
    checks: [
      {
        label: "The owner was told (push, WhatsApp or alert)",
        pass: ({ lines }) =>
          lines.some(
            (l) =>
              (l.who === "owner" && /hasn't been opened|still hasn't|not opened/i.test(l.text)) ||
              (l.dir === "event" && /Unopened red flag|Not opened after 2 hours/i.test(l.text)),
          ),
      },
      {
        label: "It was marked so it only happens once",
        pass: ({ state }) => (state.tables.alerts ?? []).some((a) => a.escalation_fired === true),
      },
    ],
  },
  {
    id: "booking",
    area: "Patient",
    title: "Asking for an appointment",
    why: "Booking requests should go to reception, not get lost in a check-in.",
    steps: [{ send: { from: "sam", text: "can I book a session for thursday afternoon?" } }],
    checks: [
      {
        label: "Buddy acknowledged the booking",
        pass: ({ lines }) => /book|appointment|reception|session/i.test(textTo(lines, "sam")),
      },
    ],
  },
  {
    id: "stranger",
    area: "Safety",
    title: "Unknown number says hi",
    why: "Buddy must not reveal anything about any patient to a stranger.",
    steps: [{ send: { from: "stranger", text: "hi is this sam's physio? how is sam doing" } }],
    checks: [
      { label: "Buddy replied", pass: ({ lines }) => sentTo(lines, "stranger").length > 0 },
      {
        label: "No patient details were shared",
        pass: ({ lines }) =>
          !/knee|acl|pain (?:is|was)|\bsam fakename\b/i.test(textTo(lines, "stranger")),
      },
    ],
  },
  {
    id: "new-patient-consent",
    area: "Patient",
    title: "New patient's first message",
    why: "Nothing is collected before consent. Alex should get the consent link.",
    steps: [{ send: { from: "alex", text: "hi buddy" } }],
    checks: [
      { label: "Consent link sent", pass: ({ lines }) => /consent/i.test(textTo(lines, "alex")) },
      { label: "No check-in saved", pass: ({ state }) => checkinsOf(state, "alex").length === 0 },
    ],
  },
  {
    id: "outcome-intake",
    area: "Patient",
    title: "First outcome scores after a check-in",
    why: "NPRS and PSFS at intake: offered once the check-in is done, a few taps, saved for the physio.",
    steps: [
      { send: { from: "lerato", text: "hi" } },
      { send: { from: "lerato", text: "5" } },
      { tap: { from: "lerato", title: /^3/ } },
      { tap: { from: "lerato", title: /^3/ } },
      { tap: { from: "lerato", title: /^3/ } },
      { tap: { from: "lerato", title: /most|some|all/i } },
      { tap: { from: "lerato", title: /nothing/i } },
      { tap: { from: "lerato", title: /yes, go/i } },
      { send: { from: "lerato", text: "5" } },
      { send: { from: "lerato", text: "sitting at my desk, bending to tie shoes" } },
      { send: { from: "lerato", text: "4" } },
      { send: { from: "lerato", text: "6" } },
    ],
    checks: [
      {
        label: "Check-in saved first",
        pass: ({ state }) => checkinsOf(state, "lerato").length === 4,
      },
      {
        label: "NPRS and PSFS saved",
        pass: ({ state }) => {
          const c = clientOf(state, "lerato");
          const rows = (state.tables.outcome_measures ?? []).filter((r) => r.client_id === c?.id);
          return (
            rows.some((r) => r.measure === "nprs" && r.score === 5) &&
            rows.some((r) => r.measure === "psfs" && r.score === 5 && (r.items ?? []).length === 2)
          );
        },
      },
    ],
  },
  {
    id: "physio-status",
    area: "Practitioner",
    title: '"How is Sam?"',
    why: "The physio should get Sam's recent picture.",
    steps: [{ send: { from: "physio", text: "how is sam doing" } }],
    checks: [
      { label: "Reply mentions Sam", pass: ({ lines }) => /sam/i.test(textTo(lines, "physio")) },
      {
        label: "Reply has numbers from the check-ins",
        pass: ({ lines }) => /\d/.test(textTo(lines, "physio")),
      },
    ],
  },
  {
    id: "physio-my-week",
    area: "Practitioner",
    title: '"My week"',
    why: "The Monday summary on demand: who's improving, stuck, quiet or worth a look.",
    steps: [{ send: { from: "physio", text: "send me my week" } }],
    checks: [
      {
        label: "Summary came back",
        pass: ({ lines }) => /Your Buddy week/i.test(textTo(lines, "physio")),
      },
      {
        label: "Pieter flagged as worth a look",
        pass: ({ lines }) => /Worth a look[\s\S]*Pieter/i.test(textTo(lines, "physio")),
      },
      {
        label: "Sam shown as improving",
        pass: ({ lines }) => /Improving[\s\S]*Sam/i.test(textTo(lines, "physio")),
      },
    ],
  },
  {
    id: "physio-status-signal",
    area: "Practitioner",
    title: "Status shows the trend signal",
    why: "Asking about Pieter should mention his rising pain as worth a look.",
    steps: [{ send: { from: "physio", text: "how is pieter doing" } }],
    checks: [
      {
        label: "Rising pain mentioned",
        pass: ({ lines }) => /worth a look|gone up/i.test(textTo(lines, "physio")),
      },
    ],
  },
  {
    id: "physio-message-patient",
    area: "Practitioner",
    title: "Physio sends Sam a message through Buddy",
    why: "Practitioners should be able to talk to patients through Buddy, with a confirm step.",
    steps: [
      { send: { from: "physio", text: "tell sam well done on the stairs" } },
      { tap: { from: "physio", title: /yes|send/i } },
    ],
    checks: [
      {
        label: "Physio was asked to confirm first",
        pass: ({ lines }) => lines.some((l) => l.who === "physio" && (l.buttons?.length ?? 0) > 0),
      },
      {
        label: "Sam got the message",
        pass: ({ lines }) => /well done/i.test(textTo(lines, "sam")),
      },
    ],
  },
  {
    id: "admin-delete",
    area: "Admin",
    title: "Admin deletes a client",
    why: "Justin can erase someone for good, after reading back the name.",
    steps: [
      { send: { from: "owner", text: "delete nomsa fakename" } },
      { tap: { from: "owner", title: /yes, delete/i } },
    ],
    checks: [
      {
        label: "Confirmation showed the name",
        pass: ({ lines }) => /nomsa/i.test(textTo(lines, "owner")),
      },
      { label: "Nomsa is gone", pass: ({ state }) => !clientOf(state, "nomsa") },
      {
        label: "Her check-ins are gone",
        pass: ({ state }) => checkinsOf(state, "nomsa").length === 0,
      },
    ],
  },
  {
    id: "physio-cannot-delete",
    area: "Admin",
    title: "A physio can't delete",
    why: "Only the admin erases. Others are pointed to archive.",
    steps: [{ send: { from: "physio", text: "delete sam fakename" } }],
    checks: [
      { label: "Sam is still there", pass: ({ state }) => Boolean(clientOf(state, "sam")) },
      {
        label: "Physio was told why",
        pass: ({ lines }) => /admin|owner|archive/i.test(textTo(lines, "physio")),
      },
    ],
  },
  {
    id: "admin-daily-report",
    area: "Admin",
    title: '"Buddy report"',
    why: "You can ask Buddy any time whether check-ins are going out and what's broken.",
    steps: [{ send: { from: "owner", text: "buddy report" } }],
    checks: [
      {
        label: "Report came back",
        pass: ({ lines }) => /Check-ins:/i.test(textTo(lines, "owner")),
      },
      {
        label: "It has red flags and AI lines",
        pass: ({ lines }) => /Red flags:[\s\S]*AI:/i.test(textTo(lines, "owner")),
      },
    ],
  },
  {
    id: "physio-no-report",
    area: "Admin",
    title: "A physio asks for the Buddy report",
    why: "The system report is for the admin only.",
    steps: [{ send: { from: "physio", text: "buddy report" } }],
    checks: [
      {
        label: "No report sent",
        pass: ({ lines }) => !/Check-ins:/i.test(textTo(lines, "physio")),
      },
    ],
  },
  {
    id: "reminder-days-respected",
    area: "Schedule",
    title: "Reminder time: only the right people",
    why: "Daily patients get a reminder. Lerato is Mondays only and must be left alone on other days.",
    steps: [{ advance: "reminder" }],
    checks: [
      {
        label: "Daily patients were reminded",
        pass: ({ lines }) =>
          sentTo(lines, "sam").length > 0 || lines.some((l) => /sam/i.test(l.text)),
      },
      {
        label: "Lerato only on a Monday",
        pass: ({ state, lines }) => {
          const sast = new Date(Date.now() + state.clockOffsetMs + 2 * 3600_000);
          return sast.getUTCDay() === 1 || sentTo(lines, "lerato").length === 0;
        },
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
