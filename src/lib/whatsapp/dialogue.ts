/**
 * Patient dialogue. One place decides the next turn from what is already
 * stored and what this bubble actually said.
 * Red flag text never reaches a friendly reply. The model is not asked for advice.
 * Buttons stay on every question so a missed reading can still be tapped.
 */

import { appointmentAnswer, bookingAsk, bookingSent, bookingTask, programmeAnswer } from "@/lib/capabilities";
import { BOOKING_URL } from "./assistant";
import { LIBRARY_COMING_SOON } from "@/lib/feature-flags";
import {
  ASSIST_MSG,
  LIBRARY_URL,
  practiceAnswerByKeywords,
  PRACTICE_SUMMARY,
} from "./assistant";
import { needsConfirm, readCheckinBubble, summaryLine, type AdherenceValue, type ScaleField } from "./checkin-read";
import { classifyIntent } from "./intent";
import { memoryList, readMemoryCommand } from "./memory-card";
import {
  alreadyDoneLine,
  celebrationLine,
  frustrationLine,
  normaliseTone,
  shortAck,
  steerToCheckin,
  type BuddyTone,
} from "./personality";
import { contextFact } from "./proactive-context";
import { IDS, MSG, STALE_CHECKIN_MS, safetyReply, type CheckinDraft, type ConversationState, type Decision, type DecisionContext } from "./conversation";

type Reply = Decision["replies"][number];
const text = (body: string): Reply => ({ kind: "text", body });

const ORDER: Array<ScaleField | "adherence" | "notes"> = [
  "pain",
  "sleep",
  "energy",
  "stress",
  "adherence",
  "notes",
];

function pendingOf(state: ConversationState, draft: CheckinDraft): ScaleField | "adherence" | "notes" | null {
  if (draft.confirming) return null;
  if (state === "awaiting_pain") return "pain";
  if (state === "awaiting_sleep") return "sleep";
  if (state === "awaiting_energy") return "energy";
  if (state === "awaiting_stress") return "stress";
  if (state === "awaiting_adherence") return "adherence";
  if (state === "awaiting_notes") return "notes";
  return null;
}

function stateFor(field: ScaleField | "adherence" | "notes" | "idle"): ConversationState {
  if (field === "pain") return "awaiting_pain";
  if (field === "sleep") return "awaiting_sleep";
  if (field === "energy") return "awaiting_energy";
  if (field === "stress") return "awaiting_stress";
  if (field === "adherence") return "awaiting_adherence";
  if (field === "notes") return "awaiting_notes";
  return "idle";
}

function nextMissing(draft: CheckinDraft): ScaleField | "adherence" | "notes" | null {
  if (typeof draft.pain !== "number") return "pain";
  if (typeof draft.sleep !== "number") return "sleep";
  if (typeof draft.energy !== "number") return "energy";
  if (typeof draft.stress !== "number") return "stress";
  if (!draft.adherence) return "adherence";
  if (!draft.notes?.length && !draft.confirming) return "notes";
  return null;
}

function ask(field: ScaleField | "adherence" | "notes", lead: string): Reply {
  if (field === "pain") {
    return {
      kind: "list",
      body: lead || MSG.askPain,
      buttonLabel: "Choose",
      rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
        id: `pain_${n}`,
        title: n === 0 ? "0 No pain" : String(n),
      })),
    };
  }
  if (field === "sleep" || field === "energy" || field === "stress") {
    const prefix = field === "sleep" ? "wsleep_" : field === "energy" ? "wenergy_" : "wstress_";
    const rows =
      field === "sleep"
        ? ["5 Very well", "4 Well", "3 Okay", "2 Poorly", "1 Very poorly"]
        : field === "energy"
          ? ["5 Very high", "4 High", "3 Okay", "2 Low", "1 Very low"]
          : ["5 Very stressed", "4 High", "3 Okay", "2 Low", "1 Very calm"];
    const title =
      field === "sleep" ? MSG.askSleep : field === "energy" ? MSG.askEnergy : MSG.askStress;
    return {
      kind: "list",
      body: lead || title,
      buttonLabel: "Choose",
      rows: rows.map((titleRow) => ({ id: `${prefix}${titleRow.slice(0, 1)}`, title: titleRow })),
    };
  }
  if (field === "adherence") {
    return {
      kind: "list",
      body: lead || MSG.askAdherence,
      buttonLabel: "Choose",
      rows: [
        { id: IDS.adherence.all, title: "All of them" },
        { id: IDS.adherence.most, title: "Most of them" },
        { id: IDS.adherence.some, title: "Some of them" },
        { id: IDS.adherence.none, title: "None of them" },
      ],
    };
  }
  return {
    kind: "buttons",
    body: lead || MSG.askNotes,
    buttons: [{ id: IDS.notesNone, title: "Nothing to add" }],
  };
}

function held(draft: CheckinDraft): string {
  const bits: string[] = [];
  if (typeof draft.pain === "number") bits.push(`pain ${draft.pain}`);
  if (typeof draft.sleep === "number") bits.push(`sleep ${draft.sleep}`);
  if (typeof draft.energy === "number") bits.push(`energy ${draft.energy}`);
  if (typeof draft.stress === "number") bits.push(`stress ${draft.stress}`);
  if (draft.adherence) bits.push(`${draft.adherence} of the programme`);
  return bits.length ? `I still have ${bits.join(", ")}.` : "I don't have a score saved yet.";
}

function saveFrom(draft: CheckinDraft, flagged: boolean, partial: boolean): Decision["saveCheckin"] {
  const notes = [...(draft.notes ?? [])];
  if (partial) notes.unshift("[partial]");
  return {
    pain: draft.pain ?? 0,
    sleep: draft.sleep ?? null,
    energy: draft.energy ?? null,
    notes: notes.join("\n").slice(0, 2000),
    flagged,
    ...(typeof draft.stress === "number" ? { stress: draft.stress } : {}),
    ...(draft.adherence ? { exerciseAdherence: draft.adherence } : {}),
  };
}

function sastClock(utc: Date): string {
  const sast = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
  const hh = String(sast.getUTCHours()).padStart(2, "0");
  const mm = String(sast.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function snap(state: ConversationState, draft: CheckinDraft, at: Date | null): Decision["next"] {
  return { state, draft, checkinStartedAt: at };
}

function yes(text: string, replyId?: string): boolean {
  return (
    replyId === IDS.saveCheckin ||
    replyId === "react_yes" ||
    /^(yes|y|yep|yeah|ja|jip|ok|okay|save|save it|please do)[.!]*$/i.test(text.trim())
  );
}

export function runDialogue(ctx: DecisionContext): Decision | null {
  const msg = ctx.message;
  if (msg.mediaType === "image" || msg.mediaType === "video") return null;
  if (!ctx.client || !ctx.hasConsent) return null;
  const blocked = new Set<ConversationState>([
    "awaiting_email",
    "awaiting_schedule",
    "awaiting_wearable",
    "awaiting_name",
    "awaiting_practitioner",
    "awaiting_consent",
    "opted_out",
    "unmatched",
    "new",
  ]);
  if (blocked.has(ctx.conversation.state)) return null;

  const raw = (msg.text ?? "").trim();
  const intent = classifyIntent({ text: raw, replyId: msg.replyId });
  if (intent.intent === "opt_out" || intent.intent === "contact_practitioner") return null;
  if (
    msg.replyId === "start_checkin" ||
    msg.replyId === "outreach_later" ||
    msg.replyId === "outreach_ok" ||
    msg.replyId === "outreach_stop"
  ) {
    return null;
  }

  const tone: BuddyTone = normaliseTone(ctx.tone);
  const name = ctx.conversation.draft.preferredName || ctx.client.firstName;
  const draft: CheckinDraft = { notes: [], ...ctx.conversation.draft };
  const started = ctx.conversation.checkinStartedAt;

  if (ctx.redFlags.triggered) {
    const safety = safetyReply(ctx.redFlags);
    return {
      replies: safety ? [text(safety)] : [],
      next: snap(ctx.conversation.state, draft, started),
      analytics: { kind: "fallback", detail: "red_flag" },
    };
  }

  if (draft.pendingBooking && (msg.replyId === IDS.bookYes || msg.replyId === "react_yes" || /^yes[.!]*$/i.test(raw))) {
    const task = draft.pendingBooking;
    const rest = { ...draft, pendingBooking: undefined };
    return {
      replies: [text(bookingSent(BOOKING_URL))],
      next: snap(ctx.conversation.state, rest, started),
      receptionErrand: task,
      analytics: { kind: "understood", detail: "booking" },
    };
  }
  if (draft.pendingBooking && (msg.replyId === IDS.bookNo || msg.replyId === "react_no" || /^no[.!]*$/i.test(raw))) {
    return {
      replies: [text(MSG.bookingCancelled)],
      next: snap(ctx.conversation.state, { ...draft, pendingBooking: undefined }, started),
      analytics: { kind: "understood", detail: "booking_no" },
    };
  }

  if (
    (msg.replyId === "react_yes" || msg.replyId === "react_no") &&
    !(draft.confirming && msg.replyId === "react_yes")
  ) {
    return {
      replies: [text(msg.replyId === "react_yes" ? "Okay." : "Okay, I won't.")],
      next: snap(ctx.conversation.state, draft, started),
      analytics: { kind: "understood", detail: "reaction" },
    };
  }

  if (draft.buddyPaused) {
    if (draft.buddyPaused.told) {
      return { replies: [], next: snap(ctx.conversation.state, draft, started) };
    }
    return {
      replies: [text("Your physio has this chat for now. I'll pick it up when they hand it back.")],
      next: snap(ctx.conversation.state, { ...draft, buddyPaused: { ...draft.buddyPaused, told: true } }, started),
    };
  }

  const stale =
    started != null && ctx.now.getTime() - started.getTime() > STALE_CHECKIN_MS && typeof draft.pain === "number";
  if (stale) {
    return {
      replies: [text(`${held(draft)} I've saved that as a partial check in. Adherence stays blank where you didn't answer.`)],
      next: snap("idle", {}, null),
      saveCheckin: saveFrom(draft, ctx.redFlags.triggered, true),
      analytics: { kind: "saved", detail: "partial" },
    };
  }

  const inCheckin = pendingOf(ctx.conversation.state, draft) != null || draft.confirming || typeof draft.pain === "number";
  const pending = pendingOf(ctx.conversation.state, draft);
  const read = readCheckinBubble(raw, {
    pending,
    replyId: msg.replyId,
    quoted: ctx.quotedText,
  });

  if (read.distress) {
    return {
      replies: [text(ASSIST_MSG.clinical)],
      next: snap(ctx.conversation.state, draft, started),
      clinicalQuestion: raw.slice(0, 1000),
      contactRequest: true,
      analytics: { kind: "fallback", detail: "distress" },
    };
  }

  const memory = readMemoryCommand(raw);
  if (memory.show) {
    return {
      replies: [text(memoryList(ctx.memories ?? []))],
      next: snap(ctx.conversation.state, draft, started ?? null),
    };
  }
  if (memory.forget) {
    return {
      replies: [text(memory.forget === "all" ? "Done. I cleared the everyday notes I had saved." : "Done. I removed that note.")],
      next: snap(ctx.conversation.state, draft, started),
      forgetMemory: memory.forget,
    };
  }
  if (memory.outreach != null) {
    return {
      replies: [text(memory.outreach ? "Okay. I may send the occasional check between sessions. Say stop extra reminders any time." : "Okay. I won't send those extra messages.")],
      next: snap(ctx.conversation.state, draft, started),
      setOutreachOptIn: memory.outreach,
    };
  }
  if (memory.preferredName) draft.preferredName = memory.preferredName;
  if (memory.save && countFilled(read) === 0 && !read.aside && !read.defer) {
    return {
      replies: [text(memory.preferredName ? `I'll call you ${memory.preferredName} in this chat.` : "I'll remember that.")],
      next: snap(ctx.conversation.state, draft, started),
      rememberFacts: ctx.aiConsent ? [memory.save] : undefined,
      analytics: { kind: "understood", detail: "memory" },
    };
  }

  if ((read.greeting || read.smallTalk) && !inCheckin && countFilled(read) === 0 && !read.aside && !read.defer) {
    if (ctx.checkedInToday) {
      const help = /\bwhat can you do\b/i.test(raw);
      return {
        replies: [text(help ? ASSIST_MSG.menuIntro(name, true) : alreadyDoneLine(tone))],
        next: snap("idle", draft, null),
        analytics: { kind: "understood", detail: "greeting" },
      };
    }
    const fact = ctx.contextFact ?? contextFact({ lastPain: ctx.voice?.lastPain, goal: ctx.voice?.goal, appointmentAt: ctx.appointmentAt, streak: ctx.voice?.streak });
    const hello = steerToCheckin(tone, name);
    return {
      replies: [ask("pain", fact ? `${hello} ${fact}` : hello)],
      next: snap("awaiting_pain", { ...draft, notes: [] }, ctx.now),
      rememberFacts: memory.save && ctx.aiConsent ? [memory.save] : undefined,
      analytics: { kind: "understood", detail: "greeting" },
    };
  }

  if (read.defer) {
    const soon = read.defer.when === "soon" ? sastClock(new Date(ctx.now.getTime() + 2 * 60 * 60 * 1000)) : null;
    const time = read.defer.time ?? soon;
    const when = time ? `I'll nudge you at ${time}.` : "We'll pick this up when you're free.";
    const field = pendingOf(ctx.conversation.state, draft);
    return {
      replies: [text(`${when} ${held(draft)}`)],
      next: snap(ctx.conversation.state === "idle" ? "idle" : ctx.conversation.state, draft, started ?? ctx.now),
      setReminderTime: time ?? undefined,
      analytics: field
        ? { kind: "dropoff", detail: field }
        : { kind: "deferred", detail: read.defer.when },
    };
  }

  if (read.correction) {
    const field = (read.correction.field ?? draft.lastField ?? pending) as ScaleField | null;
    if (field) {
      draft[field] = read.correction.value;
      draft.lastField = field;
      draft.freeText = true;
      draft.confirming = true;
      return {
        replies: [
          {
            kind: "buttons",
            body: summaryLine(draft),
            buttons: [
              { id: IDS.saveCheckin, title: "Save" },
              { id: IDS.changeCheckin, title: "Change" },
            ],
          },
        ],
        next: snap(stateFor(field), draft, started ?? ctx.now),
        analytics: { kind: "understood", detail: "correction" },
      };
    }
  }

  applyRead(draft, read);
  if (read.aside?.kind !== "clinical" && read.notes.length) {
    draft.notes = [...(draft.notes ?? []), ...read.notes].slice(-6);
  }
  if (read.aside?.kind === "booking") {
    draft.pendingBooking = bookingTask(ctx.client?.firstName ?? "A patient", raw);
  }
  if (read.aside?.kind === "clinical") {
    const missing = nextMissing(draft);
    return {
      replies: [
        text(ASSIST_MSG.clinical),
        ...(missing ? [ask(missing, held(draft))] : []),
      ],
      next: snap(missing ? stateFor(missing) : ctx.conversation.state, draft, started ?? ctx.now),
      clinicalQuestion: raw.slice(0, 1000),
      analytics: { kind: "fallback", detail: "clinical" },
    };
  }
  if (read.aside?.kind === "booking" && draft.pendingBooking && countFilled(read) === 0 && !draft.confirming) {
    return {
      replies: [bookingCard(draft.pendingBooking)],
      next: snap(inCheckin ? ctx.conversation.state : "idle", draft, inCheckin ? started ?? ctx.now : null),
      analytics: { kind: "understood", detail: "booking" },
    };
  }
  if (read.aside?.kind === "pause") {
    return {
      replies: [text(`${ASSIST_MSG.paused} ${held(draft)}`)],
      next: snap(ctx.conversation.state === "idle" ? "awaiting_pain" : ctx.conversation.state, draft, started ?? ctx.now),
      analytics: { kind: "deferred", detail: "pause" },
    };
  }

  const asideReply = asideReplies(ctx, raw, read.aside);
  const words = raw.split(/\s+/).filter(Boolean).length;
  const ackBits: string[] = [];
  if (read.tone === "frustrated") ackBits.push(frustrationLine());
  if (read.tone === "celebration" && typeof draft.pain === "number" && ctx.voice?.lastPain != null && ctx.voice.lastPain - draft.pain >= 2) {
    ackBits.push(celebrationLine());
  }
  if (words < 4 && typeof draft.pain === "number" && read.pain?.how === "digit") {
    ackBits.push(`Thanks, ${draft.pain}.`);
  } else if (countFilled(read) > 0) {
    ackBits.push(shortAck(tone, words));
  }
  const fact = !inCheckin ? ctx.contextFact : null;
  if (fact && ackBits.length === 0) ackBits.push(fact);

  const lead = [asideReply, ...ackBits].filter(Boolean).join(" ");

  if (read.ambiguous && read.ambiguousNumbers.length >= 2) {
    const [a, b] = read.ambiguousNumbers;
    const buttons: Array<{ id: string; title: string }> = [
      { id: `amb_pain_${a}`, title: `Pain ${a}`.slice(0, 20) },
    ];
    if (b >= 1 && b <= 5) buttons.push({ id: `amb_sleep_${b}`, title: `Sleep ${b}` });
    else buttons.push({ id: `amb_pain_${b}`, title: `Pain ${b}`.slice(0, 20) });
    return {
      replies: [
        {
          kind: "buttons",
          body: "I can see more than one number. Which should I keep?",
          buttons,
        },
      ],
      next: snap("awaiting_pain", draft, started ?? ctx.now),
      analytics: { kind: "fallback", detail: "ambiguous" },
    };
  }

  const confirming = draft.confirming || (needsConfirm(read) && typeof draft.pain === "number");
  if ((read.saveNow || (draft.confirming && yes(raw, msg.replyId))) && typeof draft.pain === "number") {
    return finish(ctx, draft, false);
  }
  if (confirming && typeof draft.pain === "number" && (needsConfirm(read) || draft.freeText || draft.confirming)) {
    draft.confirming = true;
    draft.freeText = true;
    const missing = nextMissing({ ...draft, confirming: true, notes: draft.notes?.length ? draft.notes : ["kept"] });
    const extra = missing && missing !== "notes" ? ` I can still ask about ${missing}.` : "";
    return {
      replies: [
        ...(draft.pendingBooking && read.aside?.kind === "booking" ? [bookingCard(draft.pendingBooking)] : []),
        ...(lead ? [text(lead)] : []),
        {
          kind: "buttons",
          body: `${summaryLine(draft)}${extra}`,
          buttons: [
            { id: IDS.saveCheckin, title: "Save" },
            { id: IDS.changeCheckin, title: "Change" },
          ],
        },
      ],
      next: snap(stateFor(missing ?? "notes"), draft, started ?? ctx.now),
      rememberFacts: memory.save && ctx.aiConsent ? [memory.save] : undefined,
      analytics: { kind: "understood", detail: "confirm" },
    };
  }

  if (read.saveNow && typeof draft.pain !== "number") {
    return {
      replies: [ask("pain", "I still need a pain score before I can save.")],
      next: snap("awaiting_pain", draft, started ?? ctx.now),
      analytics: { kind: "fallback", detail: "pain" },
    };
  }

  if (read.skip && pending && pending !== "pain") {
    const after = ORDER[ORDER.indexOf(pending) + 1] ?? null;
    if (!after) return finish(ctx, draft, false);
    return {
      replies: [ask(after, "No problem, we'll leave that blank.")],
      next: snap(stateFor(after), { ...draft, misses: 0 }, started ?? ctx.now),
      analytics: { kind: "understood", detail: "skip" },
    };
  }

  const missing = nextMissing(draft);
  if (!missing && typeof draft.pain === "number") {
    if (draft.freeText) {
      draft.confirming = true;
      return {
        replies: [
          {
            kind: "buttons",
            body: summaryLine(draft),
            buttons: [
              { id: IDS.saveCheckin, title: "Save" },
              { id: IDS.changeCheckin, title: "Change" },
            ],
          },
        ],
        next: snap("awaiting_notes", draft, started ?? ctx.now),
        analytics: { kind: "understood", detail: "confirm" },
      };
    }
    return finish(ctx, draft, false);
  }

  if (msg.replyId === IDS.notesNone && pending === "notes" && typeof draft.pain === "number") {
    return finish(ctx, draft, false);
  }

  if (missing) {
    const quote = read.notes[0] ? `${read.notes[0].slice(0, 80)}.` : "";
    const prompt =
      words >= 4 && quote && missing !== "pain"
        ? `${quote} ${questionTitle(missing)}`
        : lead
          ? `${lead} ${questionTitle(missing)}`
          : questionTitle(missing);
    return {
      replies: [
        ...(draft.pendingBooking && read.aside?.kind === "booking" ? [bookingCard(draft.pendingBooking)] : []),
        ask(missing, prompt),
      ],
      next: snap(stateFor(missing), { ...draft, lastField: missing === "notes" || missing === "adherence" ? draft.lastField : missing }, started ?? ctx.now),
      rememberFacts: memory.save && ctx.aiConsent ? [memory.save] : undefined,
      receptionErrand: undefined,
      analytics: { kind: countFilled(read) ? "understood" : "fallback", detail: missing },
    };
  }

  if (asideReply) {
    return {
      replies: [text(asideReply)],
      next: snap(ctx.conversation.state, draft, started),
      analytics: { kind: "understood", detail: read.aside?.kind ?? "aside" },
    };
  }

  if (!ctx.checkedInToday) {
    return {
      replies: [ask("pain", steerToCheckin(tone, name))],
      next: snap("awaiting_pain", draft, ctx.now),
      analytics: { kind: "fallback", detail: "pain" },
    };
  }

  if (/\?/.test(raw) || read.aside) {
    return {
      replies: [text(ASSIST_MSG.clarify)],
      next: snap("idle", {}, null),
      analytics: { kind: "fallback", detail: "clarify" },
    };
  }
  return {
    replies: [text("Thanks, I've passed that on to your physiotherapist.")],
    next: snap("idle", {}, null),
    noteForPractitioner: raw.slice(0, 1000),
    analytics: { kind: "understood", detail: "note" },
  };
}

function countFilled(read: ReturnType<typeof readCheckinBubble>): number {
  return [read.pain, read.sleep, read.energy, read.stress, read.adherence].filter(Boolean).length;
}

function applyRead(draft: CheckinDraft, read: ReturnType<typeof readCheckinBubble>): void {
  const put = (field: ScaleField, score: { value: number; how: string } | null) => {
    if (!score) return;
    draft[field] = score.value;
    draft.lastField = field;
    if (score.how !== "digit") draft.freeText = true;
  };
  put("pain", read.pain);
  put("sleep", read.sleep);
  put("energy", read.energy);
  put("stress", read.stress);
  if (read.adherence) {
    draft.adherence = read.adherence.value;
    if (read.adherence.how === "word") draft.freeText = true;
  }
}

function questionTitle(field: ScaleField | "adherence" | "notes"): string {
  if (field === "pain") return MSG.askPain;
  if (field === "sleep") return MSG.askSleep;
  if (field === "energy") return MSG.askEnergy;
  if (field === "stress") return MSG.askStress;
  if (field === "adherence") return MSG.askAdherence;
  return MSG.askNotes;
}

function asideReplies(ctx: DecisionContext, raw: string, aside: ReturnType<typeof readCheckinBubble>["aside"]): string | null {
  if (!aside) return null;
  if (aside.kind === "practice") return practiceAnswerByKeywords(raw) ?? PRACTICE_SUMMARY;
  if (aside.kind === "appointment") return appointmentAnswer(ctx.appointmentAt ?? null);
  if (aside.kind === "programme") {
    return programmeAnswer({
      assigned: ctx.assignedExercise ?? null,
      libraryLive: !LIBRARY_COMING_SOON,
      libraryUrl: LIBRARY_URL,
    });
  }
  if (aside.kind === "booking") return null;
  if (aside.kind === "clinical") return ASSIST_MSG.clinical;
  if (aside.kind === "pause") return `${ASSIST_MSG.paused} ${held(ctx.conversation.draft)}`;
  if (aside.kind === "wearable") return ctx.watchUrl ? MSG.wearableLinkDirect(ctx.watchUrl) : MSG.wearableLink;
  if (aside.kind === "help") return "I can log a check in, pass a note to your physio, or share the practice hours. Say what you need.";
  return null;
}

function bookingCard(task: string): Reply {
  return {
    kind: "buttons",
    body: bookingAsk(task),
    buttons: [
      { id: IDS.bookYes, title: "Yes" },
      { id: IDS.bookNo, title: "No" },
    ],
  };
}

function finish(ctx: DecisionContext, draft: CheckinDraft, partial: boolean): Decision {
  const saved = ctx.voice
    ? `Thanks ${draft.preferredName || ctx.client?.firstName || ""}, that's saved and your physiotherapist can see it.`.replace(/\s+/g, " ").trim()
    : MSG.saved;
  return {
    replies: [text(saved)],
    next: snap("idle", {}, null),
    saveCheckin: saveFrom(draft, false, partial),
    analytics: { kind: "saved", detail: partial ? "partial" : "full" },
  };
}
