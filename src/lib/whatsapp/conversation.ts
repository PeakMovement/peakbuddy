import type { OutboundMessage } from "./provider";
import { extractDeterministic } from "./extraction";
import { classifyIntent, CONTACT_ACKNOWLEDGEMENT, OPT_OUT_CONFIRMATION } from "./intent";
import type { RuleLayerResult } from "./red-flag-rules";
import { currentConsent } from "@/lib/consent/wording";
import {
  ASSIST_MSG,
  CHECKIN_REQUEST,
  practiceAnswerByKeywords,
  routeByKeywords,
  type AssistRoute,
} from "./assistant";

/**
 * The WhatsApp check-in conversation, as a pure function.
 *
 * Every inbound message goes through `decide`, which looks at where this
 * patient is in the conversation and returns what to say and what to record.
 * It touches nothing: no database, no network, no clock it was not handed.
 * The worker executes the decision. Keeping the two apart is what makes the
 * whole conversation testable message by message.
 *
 * Scope settled by Justin on 4 October: Buddy asks how the patient is, reads
 * the answer, writes it to their profile. No practitioner takes over the chat.
 * STOP is honoured immediately. "Call me" becomes an alert. Red flags are
 * decided OUTSIDE this function (red-flag-rules.ts runs on every message,
 * whatever state the conversation is in) and only passed in so the reply can
 * carry the safety message.
 *
 * The check-in asks exactly what the app's check-in form asks, on the same
 * scales, so a WhatsApp check-in and an app check-in are the same row:
 *   pain 0 to 10, sleep 1 to 5, energy 1 to 5, then free notes.
 */

export type ConversationState =
  | "new"
  | "awaiting_consent"
  | "idle"
  | "awaiting_pain"
  | "awaiting_sleep"
  | "awaiting_energy"
  | "awaiting_notes"
  | "awaiting_wearable"
  | "opted_out"
  | "unmatched";

export interface CheckinDraft {
  pain?: number;
  sleep?: number;
  energy?: number;
  /** Anything the patient wrote along the way, in their own words. */
  notes?: string[];
  /** How many times in a row the current question has not been understood. */
  misses?: number;
  /** A "log a change" update: pain and what changed only, saved alongside today's check-in. */
  update?: boolean;
}

export interface ConversationSnapshot {
  state: ConversationState;
  draft: CheckinDraft;
  /** When the current check-in began. Stale drafts are abandoned, not resumed. */
  checkinStartedAt: Date | null;
}

export interface InboundForDecision {
  text: string;
  replyId?: string;
  kind: "text" | "interactive" | "media" | "unsupported";
  /** Set for media. A voice note we could not transcribe gets its own reply. */
  mediaType?: "audio" | "other";
}

/**
 * What the AI read out of a free-text answer, when the deterministic reader
 * could not. Only ever a fallback: a number the patient typed always wins.
 * Absent when the patient has not given AI consent.
 */
export interface AiAssist {
  painScore?: number | null;
  sleep?: number | null;
  energy?: number | null;
}

export interface DecisionContext {
  message: InboundForDecision;
  conversation: ConversationSnapshot;
  /** Null when the number matches no Buddy profile. */
  client: { firstName: string } | null;
  /** A current, unwithdrawn WhatsApp consent exists for this profile. */
  hasConsent: boolean;
  /** The profile already has a check-in for today (South African date). */
  checkedInToday: boolean;
  /** Layer 1 safety result for this message, already computed. */
  redFlags: RuleLayerResult;
  now: Date;
  /** The profile already has a wearable connected. */
  hasWearable?: boolean;
  /** Buddy has already offered to connect a wearable once. */
  wearableOffered?: boolean;
  assist?: AiAssist;
  /** What a non-answer message is for, from the AI router. Keywords when absent. */
  route?: AssistRoute;
  /** The patient's own trend, worked out by the worker when they ask. */
  progressText?: string;
}

export interface CheckinToSave {
  pain: number;
  sleep: number | null;
  energy: number | null;
  notes: string;
  flagged: boolean;
}

export interface Decision {
  replies: Array<DistributiveOmit<OutboundMessage, "to">>;
  next: ConversationSnapshot;
  recordConsent?: boolean;
  optOut?: boolean;
  optIn?: boolean;
  contactRequest?: boolean;
  /** Free text sent after today's check-in. Passed to the practitioner, not lost. */
  noteForPractitioner?: string;
  saveCheckin?: CheckinToSave;
  /** Record that the wearable offer was made, so it is made once. */
  markWearableOffered?: boolean;
  /** "HH:MM", South African time. The patient asked to be checked in at this time. */
  setReminderTime?: string;
  /** A clinical question Buddy will not answer. Justin is alerted with it. */
  clinicalQuestion?: string;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A half-finished check-in older than this is dropped and started over. */
export const STALE_CHECKIN_MS = 12 * 60 * 60 * 1000;

export const IDS = {
  consentYes: "consent_yes",
  consentNo: "consent_no",
  notesNone: "notes_none",
  wearableYes: "wear_yes",
  wearableNo: "wear_no",
  sleep: (n: number) => `wsleep_${n}`,
  energy: (n: number) => `wenergy_${n}`,
} as const;

const PRACTICE_PHONE = "067 369 0593";

/**
 * Where the app's own "Connect" button on the check-in screen goes. Opening it
 * from WhatsApp asks the patient to sign in first, then lands them on the
 * Wearables section, opened.
 */
export const WEARABLE_CONNECT_URL = "https://peakbuddy.lovable.app/client/app/profile#wearables";

/* ------------------------------------------------------------------ */
/* Wording                                                             */
/* ------------------------------------------------------------------ */

export const MSG = {
  unmatched:
    "Hi, this is Buddy from Peak Movement. I can't find this number on a Buddy profile yet, so I can't log anything for you. Please ask your physiotherapist to add this cellphone number to your Buddy profile, or phone the practice on " +
    PRACTICE_PHONE +
    ". In an emergency phone 10177, or 112 from any cellphone.",
  consentIntro: (firstName: string) => {
    const v = currentConsent("whatsapp_checkins");
    const body = v.sections.map((s) => s.body).join("\n\n");
    return `Hi ${firstName}, this is Buddy from Peak Movement.\n\n${body}\n\n${v.affirmation}\n\nFull details: https://peakbuddy.lovable.app/consent`;
  },
  consentThanks: "Thank you, that's recorded.",
  consentDeclined:
    "No problem, I won't send you check-ins. Your treatment is not affected in any way. If you change your mind, reply START.",
  consentRetry: "Please tap I agree or No thanks so I know how you'd like to go ahead.",
  checkinOpener: (firstName: string) => `Hi ${firstName}, time for a quick check-in.`,
  askPain:
    "How is your pain right now? Reply with a number from 0 (no pain) to 10 (worst pain imaginable).",
  askPainRetry:
    "Sorry, I didn't catch that. Please reply with just a number from 0 to 10 for your pain right now.",
  askSleep: "How did you sleep last night?",
  askSleepRetry:
    "Please pick one from the list, or reply with a number from 1 (very poorly) to 5 (very well).",
  askEnergy: "How is your energy today?",
  askEnergyRetry:
    "Please pick one from the list, or reply with a number from 1 (very low) to 5 (very high).",
  askNotes:
    "Anything else you'd like your physiotherapist to know? Type it here, or tap Nothing to add.",
  saved: "Thanks, that's saved to your Buddy profile and your physiotherapist can see it.",
  alreadyToday:
    "You've already checked in today, thank you. If anything changes, tell me here and I'll make sure your physiotherapist sees it.",
  noteAdded: "Thanks, I've passed that on to your physiotherapist.",
  unsupported:
    "Sorry, I can only read typed messages, voice notes and button replies at the moment.",
  voiceUnreadable:
    "Sorry, I couldn't make out that voice note. Could you type your answer instead?",
  wearableOffer:
    "One more thing. Do you wear a smartwatch or ring, like a Garmin, Oura or Polar? If you connect it, your physiotherapist can see your sleep, heart rate and activity alongside your check-ins, without you having to type anything.",
  wearableLink:
    "Great. Tap this link, sign in to Buddy if it asks, and choose your device under Wearables:\n\n" +
    WEARABLE_CONNECT_URL +
    "\n\nIt only takes a minute. Garmin, Oura and Polar are supported.",
  wearableDeclined:
    "No problem. If you change your mind, just send me the word WATCH and I'll send the link.",
  reminderSet: (hhmm: string) =>
    `Done, your check-in time is now ${hhmm} every day. Reply with a new time whenever you like.`,
} as const;

/**
 * Safety replies. DRAFT, pending Justin's clinical sign-off: the final per
 * category wording sits in the "Clinical and consent wording" doc. Numbers are
 * the ones verified on 2 October: ambulance 10177, cellphone 112, SADAG 0800
 * 567 567.
 */
export function safetyReply(flags: RuleLayerResult): string | null {
  if (!flags.triggered) return null;
  if (flags.category === "mental_health") {
    return (
      "Thank you for telling me. I've let your physiotherapist know. You don't have to deal with this alone: " +
      "the SADAG Suicide Crisis Helpline is free on 0800 567 567, any time. If you are in danger right now, phone 10177, or 112 from any cellphone."
    );
  }
  if (flags.urgency === "emergency") {
    return (
      "What you've described could be serious. Please phone 10177 for an ambulance, or 112 from any cellphone, now. " +
      "I've alerted your physiotherapist, but please don't wait for them to reply."
    );
  }
  if (flags.urgency === "urgent" || flags.urgency === "soon") {
    return (
      "Thanks for telling me. I've flagged this to your physiotherapist so they can follow up with you. " +
      `If it gets worse or you're worried, phone the practice on ${PRACTICE_PHONE}, or 10177 in an emergency.`
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Parsing answers                                                      */
/* ------------------------------------------------------------------ */

const YES = /^(yes|y|yep|yeah|ok|okay|i agree|agree|ja|jip|reg so|sure)[.!]*$/i;
const NO = /^(no|n|nope|no thanks|no thank you|nee|nee dankie)[.!]*$/i;
const START = /^(start|resume|begin)[.!]*$/i;

const NOT_PAIN_UNIT =
  /^\s*(?:hours?|hrs?|h\b|min|mins|minutes?|days?|weeks?|months?|km|kg|reps?|sets?|%|am\b|pm\b|times?|x\b|uur|dae|weke)/i;

/**
 * Pain, when pain is what we just asked for. The shared extractor handles a
 * bare number and "pain 6/10". On top of that, because the question was
 * literally "reply with a number", a sentence carrying exactly one plausible
 * number ("about a 5, stiff after sitting") is read as the answer. Two numbers,
 * or a number with a unit ("slept 7 hours"), is not guessed at.
 */
export function readPain(msg: InboundForDecision): number | null {
  const r = extractDeterministic({ text: msg.text, replyId: msg.replyId, expecting: "painScore" });
  if (r.painScore !== null) return r.painScore;
  const text = msg.text ?? "";
  const found: number[] = [];
  const re = /(?<![\d/]|\d[.,])(\d{1,2})(?!\d|[.,]\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index + m[1].length);
    if (/^\s*\/\s*10\b/.test(after)) return Number(m[1]) <= 10 ? Number(m[1]) : null;
    if (NOT_PAIN_UNIT.test(after)) continue;
    found.push(Number(m[1]));
  }
  if (found.length === 1 && found[0] >= 0 && found[0] <= 10) return found[0];
  return null;
}

/** 1 to 5 from our own list id, or a bare digit typed back. */
export function readScale(msg: InboundForDecision, prefix: "wsleep_" | "wenergy_"): number | null {
  if (msg.replyId?.startsWith(prefix)) {
    const n = Number(msg.replyId.slice(prefix.length));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  }
  const m = msg.text.trim().match(/^([1-5])(?:\s*\/\s*5)?[.!]*$/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Question builders                                                   */
/* ------------------------------------------------------------------ */

const SLEEP_ROWS = [
  { n: 5, title: "5 Very well" },
  { n: 4, title: "4 Well" },
  { n: 3, title: "3 Okay" },
  { n: 2, title: "2 Poorly" },
  { n: 1, title: "1 Very poorly" },
];
const ENERGY_ROWS = [
  { n: 5, title: "5 Very high" },
  { n: 4, title: "4 High" },
  { n: 3, title: "3 Okay" },
  { n: 2, title: "2 Low" },
  { n: 1, title: "1 Very low" },
];

type Reply = Decision["replies"][number];

const text = (body: string): Reply => ({ kind: "text", body });

const consentPrompt = (firstName: string): Reply => ({
  kind: "buttons",
  body: MSG.consentIntro(firstName),
  buttons: [
    { id: IDS.consentYes, title: "I agree" },
    { id: IDS.consentNo, title: "No thanks" },
  ],
});

const askSleep = (body: string = MSG.askSleep): Reply => ({
  kind: "list",
  body,
  buttonLabel: "Choose",
  rows: SLEEP_ROWS.map((r) => ({ id: IDS.sleep(r.n), title: r.title })),
});

const askEnergy = (body: string = MSG.askEnergy): Reply => ({
  kind: "list",
  body,
  buttonLabel: "Choose",
  rows: ENERGY_ROWS.map((r) => ({ id: IDS.energy(r.n), title: r.title })),
});

const wearableOffer = (): Reply => ({
  kind: "buttons",
  body: MSG.wearableOffer,
  buttons: [
    { id: IDS.wearableYes, title: "Yes, connect it" },
    { id: IDS.wearableNo, title: "Not now" },
  ],
});

/** "connect my watch", "link my garmin", or just "watch". */
const WEARABLE_REQUEST =
  /^(watch|wearable|smartwatch|garmin|oura|polar)[.!]*$|\b(connect|link|add|sync|koppel)\b.{0,25}\b(watch|wearable|smartwatch|garmin|oura|polar|ring|horlosie)\b/i;

/**
 * "remind me at 7am", "check in at 18:30", "change my check-in time to 6pm".
 * Returns "HH:MM" or null. Hours outside a day, or ambiguous text, give null.
 */
export function readReminderTime(text: string): string | null {
  const m = text.match(
    /\b(?:remind|reminder|check[\s-]?in|message|text|herinner)\b.{0,30}?\b(?:at|to|for|om)\s*(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i,
  );
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] ?? "").toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const askNotes = (): Reply => ({
  kind: "buttons",
  body: MSG.askNotes,
  buttons: [{ id: IDS.notesNone, title: "Nothing to add" }],
});

/* ------------------------------------------------------------------ */
/* decide                                                              */
/* ------------------------------------------------------------------ */

const IDLE = (s: ConversationSnapshot["state"] = "idle"): ConversationSnapshot => ({
  state: s,
  draft: {},
  checkinStartedAt: null,
});

function startCheckin(ctx: DecisionContext, lead: Reply[], seedNotes: string[] = []): Decision {
  if (ctx.checkedInToday) {
    return { replies: [...lead, text(MSG.alreadyToday)], next: IDLE() };
  }
  return {
    replies: [...lead, text(MSG.checkinOpener(ctx.client!.firstName)), text(MSG.askPain)],
    next: { state: "awaiting_pain", draft: { notes: seedNotes }, checkinStartedAt: ctx.now },
  };
}

function withSafety(decision: Decision, ctx: DecisionContext): Decision {
  const safety = safetyReply(ctx.redFlags);
  if (!safety) return decision;
  if (ctx.redFlags.urgency === "emergency") {
    // An emergency ends the check-in. The only thing that matters now is the
    // safety message, and a pain question after "call an ambulance" is wrong.
    return {
      ...decision,
      replies: [text(safety)],
      next: decision.saveCheckin ? decision.next : IDLE(),
    };
  }
  return { ...decision, replies: [text(safety), ...decision.replies] };
}

export function decide(ctx: DecisionContext): Decision {
  const { message: msg, conversation: conv } = ctx;
  const raw = (msg.text ?? "").trim();

  // 1. Unknown number. Nothing is recorded anywhere clinical.
  if (!ctx.client) {
    const safety = safetyReply(ctx.redFlags);
    return {
      replies: [...(safety ? [text(safety)] : []), text(MSG.unmatched)],
      next: IDLE("unmatched"),
    };
  }
  const firstName = ctx.client.firstName;

  // 2. Opted out. Only START does anything. Silence otherwise: they asked us
  //    to stop. Red flags still alert the practitioner (handled by the caller),
  //    and the safety message still goes out, because silence after "I can't
  //    feel my legs" is not respect for an opt-out.
  if (conv.state === "opted_out") {
    if (START.test(raw)) {
      return {
        replies: [consentPrompt(firstName)],
        next: IDLE("awaiting_consent"),
        optIn: true,
      };
    }
    const safety = safetyReply(ctx.redFlags);
    return { replies: safety ? [text(safety)] : [], next: conv };
  }

  // 3. Opt-out and contact requests win in every other state.
  const intent = classifyIntent({ text: raw, replyId: msg.replyId });
  if (
    intent.intent === "opt_out" ||
    msg.replyId === IDS.consentNo ||
    (conv.state === "awaiting_consent" && NO.test(raw))
  ) {
    const declinedConsent = conv.state === "awaiting_consent" || msg.replyId === IDS.consentNo;
    const safety = safetyReply(ctx.redFlags);
    return {
      replies: [
        ...(safety ? [text(safety)] : []),
        text(declinedConsent ? MSG.consentDeclined : OPT_OUT_CONFIRMATION),
      ],
      next: IDLE("opted_out"),
      optOut: true,
    };
  }
  if (intent.intent === "contact_practitioner") {
    return withSafety(
      { replies: [text(CONTACT_ACKNOWLEDGEMENT)], next: conv, contactRequest: true },
      ctx,
    );
  }

  // 4. Consent before anything is collected.
  if (!ctx.hasConsent) {
    if (conv.state === "awaiting_consent") {
      if (msg.replyId === IDS.consentYes || YES.test(raw)) {
        const started = startCheckin(ctx, [text(MSG.consentThanks)]);
        return withSafety({ ...started, recordConsent: true }, ctx);
      }
      return withSafety(
        { replies: [text(MSG.consentRetry), consentPrompt(firstName)], next: conv },
        ctx,
      );
    }
    return withSafety({ replies: [consentPrompt(firstName)], next: IDLE("awaiting_consent") }, ctx);
  }

  if (msg.kind === "media" || msg.kind === "unsupported") {
    if (!raw) {
      const reply = msg.mediaType === "audio" ? MSG.voiceUnreadable : MSG.unsupported;
      return withSafety({ replies: [text(reply)], next: conv }, ctx);
    }
  }

  // Asking for a check-in time works from anywhere in the conversation, and
  // does not disturb a check-in in progress.
  // Not while writing their notes, where "my scan is at 3" is a note.
  const reminder = conv.state === "awaiting_notes" ? null : readReminderTime(raw);
  if (reminder) {
    return withSafety(
      { replies: [text(MSG.reminderSet(reminder))], next: conv, setReminderTime: reminder },
      ctx,
    );
  }

  // 5. A half-finished check-in from yesterday is not resumed.
  const stale =
    conv.checkinStartedAt !== null &&
    ctx.now.getTime() - conv.checkinStartedAt.getTime() > STALE_CHECKIN_MS;
  const state: ConversationState =
    conv.state.startsWith("awaiting_") && conv.state !== "awaiting_consent" && !stale
      ? conv.state
      : "idle";

  const draft: CheckinDraft = { notes: [], ...conv.draft };
  const keep = (
    next: Partial<CheckinDraft>,
    nextState: ConversationState,
  ): ConversationSnapshot => ({
    state: nextState,
    draft: { ...draft, ...next },
    checkinStartedAt: conv.checkinStartedAt ?? ctx.now,
  });

  switch (state) {
    case "awaiting_pain": {
      const pain = readPain(msg) ?? ctx.assist?.painScore ?? null;
      if (pain === null) {
        // Not a number. Keep what they said for the practitioner and ask again.
        const notes = raw ? [...(draft.notes ?? []), raw] : draft.notes;
        return withSafety(
          {
            replies: [text(MSG.askPainRetry)],
            next: keep({ notes, misses: (draft.misses ?? 0) + 1 }, "awaiting_pain"),
          },
          ctx,
        );
      }
      // "About a 6, knee is stiff" carries more than the number.
      const extra = raw && !/^\d{1,2}(\s*\/\s*10)?[.!]*$/.test(raw) ? [raw] : [];
      if (draft.update) {
        // Logging a change: pain, then what changed. No sleep or energy.
        return withSafety(
          {
            replies: [text(ASSIST_MSG.changeAskWhat)],
            next: keep(
              { pain, notes: [...(draft.notes ?? []), ...extra], misses: 0 },
              "awaiting_notes",
            ),
          },
          ctx,
        );
      }
      return withSafety(
        {
          replies: [askSleep()],
          next: keep(
            { pain, notes: [...(draft.notes ?? []), ...extra], misses: 0 },
            "awaiting_sleep",
          ),
        },
        ctx,
      );
    }

    case "awaiting_sleep": {
      const sleep = readScale(msg, "wsleep_") ?? ctx.assist?.sleep ?? null;
      if (sleep === null) {
        const notes = raw ? [...(draft.notes ?? []), raw] : draft.notes;
        return withSafety(
          {
            replies: [askSleep(MSG.askSleepRetry)],
            next: keep({ notes, misses: (draft.misses ?? 0) + 1 }, "awaiting_sleep"),
          },
          ctx,
        );
      }
      return withSafety(
        { replies: [askEnergy()], next: keep({ sleep, misses: 0 }, "awaiting_energy") },
        ctx,
      );
    }

    case "awaiting_energy": {
      const energy = readScale(msg, "wenergy_") ?? ctx.assist?.energy ?? null;
      if (energy === null) {
        const notes = raw ? [...(draft.notes ?? []), raw] : draft.notes;
        return withSafety(
          {
            replies: [askEnergy(MSG.askEnergyRetry)],
            next: keep({ notes, misses: (draft.misses ?? 0) + 1 }, "awaiting_energy"),
          },
          ctx,
        );
      }
      return withSafety(
        { replies: [askNotes()], next: keep({ energy, misses: 0 }, "awaiting_notes") },
        ctx,
      );
    }

    case "awaiting_notes": {
      const added = msg.replyId === IDS.notesNone ? [] : raw ? [raw] : [];
      const notes = [...(draft.notes ?? []), ...added].join("\n").slice(0, 2000);
      if (draft.update) {
        return withSafety(
          {
            replies: [text(ASSIST_MSG.changeSaved)],
            next: IDLE(),
            saveCheckin: {
              pain: draft.pain ?? 0,
              sleep: null,
              energy: null,
              notes: `Update: ${notes}`.slice(0, 2000),
              flagged: ctx.redFlags.triggered,
            },
          },
          ctx,
        );
      }
      // After the first check-in, offer to connect a wearable. Once only.
      const offer = !ctx.hasWearable && !ctx.wearableOffered;
      const decision: Decision = {
        replies: offer ? [text(MSG.saved), wearableOffer()] : [text(MSG.saved)],
        next: offer ? { state: "awaiting_wearable", draft: {}, checkinStartedAt: ctx.now } : IDLE(),
        markWearableOffered: offer || undefined,
        saveCheckin: {
          pain: draft.pain ?? 0,
          sleep: draft.sleep ?? null,
          energy: draft.energy ?? null,
          notes,
          flagged: ctx.redFlags.triggered,
        },
      };
      return withSafety(decision, ctx);
    }

    case "awaiting_wearable": {
      if (msg.replyId === IDS.wearableYes || YES.test(raw) || WEARABLE_REQUEST.test(raw)) {
        return withSafety({ replies: [text(MSG.wearableLink)], next: IDLE() }, ctx);
      }
      if (msg.replyId === IDS.wearableNo || NO.test(raw) || /^not now[.!]*$/i.test(raw)) {
        return withSafety({ replies: [text(MSG.wearableDeclined)], next: IDLE() }, ctx);
      }
      // Something else entirely. Drop the offer and treat it as a fresh message.
      return decide({ ...ctx, conversation: IDLE() });
    }

    default: {
      if (WEARABLE_REQUEST.test(raw)) {
        return withSafety(
          { replies: [text(MSG.wearableLink)], next: IDLE(), markWearableOffered: true },
          ctx,
        );
      }
      if (CHECKIN_REQUEST.test(raw)) return withSafety(startCheckin(ctx, []), ctx);

      // Questions and requests get answered rather than turned into a check-in.
      const route = ctx.route ?? routeByKeywords(raw);
      const nudge = ctx.checkedInToday ? [] : [text(ASSIST_MSG.checkinNudge)];
      switch (route.intent) {
        case "capabilities":
          return withSafety(
            { replies: [text(ASSIST_MSG.capabilities)], next: IDLE() },
            ctx,
          );
        case "log_change":
          // Before today's check-in, the check-in itself is the way to log it.
          if (!ctx.checkedInToday) return withSafety(startCheckin(ctx, []), ctx);
          return withSafety(
            {
              replies: [text(ASSIST_MSG.changeAskPain)],
              next: {
                state: "awaiting_pain",
                draft: { notes: [], update: true },
                checkinStartedAt: ctx.now,
              },
            },
            ctx,
          );
        case "booking":
          return withSafety({ replies: [text(ASSIST_MSG.booking), ...nudge], next: IDLE() }, ctx);
        case "practice_info":
          return withSafety(
            {
              replies: [
                text(route.answer ?? practiceAnswerByKeywords(raw) ?? ASSIST_MSG.practiceUnknown),
                ...nudge,
              ],
              next: IDLE(),
            },
            ctx,
          );
        case "clinical_question":
          return withSafety(
            {
              replies: [text(ASSIST_MSG.clinical)],
              next: IDLE(),
              clinicalQuestion: raw.slice(0, 1000),
            },
            ctx,
          );
        case "progress":
          return withSafety(
            {
              replies: [text(ctx.progressText ?? ASSIST_MSG.progressNone), ...nudge],
              next: IDLE(),
            },
            ctx,
          );
        case "exercises":
          return withSafety({ replies: [text(ASSIST_MSG.exercises), ...nudge], next: IDLE() }, ctx);
        default:
          break;
      }

      // Idle. Any message starts today's check-in, unless it is already done,
      // in which case what they wrote is a note for the practitioner.
      if (ctx.checkedInToday) {
        const isChitChat =
          !raw || /^(hi|hello|hey|hallo|thanks|thank you|dankie|ok|okay)[.!]*$/i.test(raw);
        // A short question we couldn't place is asked back, not silently filed as a note.
        const isUnplacedQuestion =
          !isChitChat && /\?\s*$/.test(raw) && raw.length < 120 && !ctx.redFlags.triggered;
        if (isUnplacedQuestion) {
          return withSafety({ replies: [text(ASSIST_MSG.clarify)], next: IDLE() }, ctx);
        }
        return withSafety(
          {
            replies: [text(isChitChat ? MSG.alreadyToday : MSG.noteAdded)],
            next: IDLE(),
            noteForPractitioner: isChitChat ? undefined : raw.slice(0, 1000),
          },
          ctx,
        );
      }
      // Whatever they opened with is kept for the practitioner, unless it was just hello.
      const seed = route.intent === "other" && raw ? [raw] : [];
      return withSafety(startCheckin(ctx, [], seed), ctx);
    }
  }
}
