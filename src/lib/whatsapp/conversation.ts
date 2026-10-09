import type { OutboundMessage } from "./provider";
import { extractDeterministic } from "./extraction";
import { classifyIntent, CONTACT_ACKNOWLEDGEMENT, OPT_OUT_CONFIRMATION } from "./intent";
import type { RuleLayerResult } from "./red-flag-rules";
import type { ConverseResult } from "./converse";
import {
  ONBOARD_MSG,
  looksLikeEmail,
  matchPractitioner,
  readName,
  type PractitionerOption,
} from "./onboarding";
import { currentConsent } from "@/lib/consent/wording";
import {
  afterEnergy,
  afterPain,
  afterSleep,
  opener,
  painQuestion,
  saved as savedLine,
  type VoiceContext,
} from "./voice";
import {
  DEFAULT_TIME,
  FREQUENCIES,
  readFrequency,
  SCHEDULE_MSG,
  TIMES,
  type ScheduleChoice,
} from "./schedule";
import {
  ASSIST_MSG,
  CHECKIN_REQUEST,
  MENU,
  PRACTICE_SUMMARY,
  routeFromMenu,
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
  | "awaiting_name"
  | "awaiting_practitioner"
  | "awaiting_email"
  | "awaiting_schedule"
  | "opted_out"
  | "unmatched";

export interface CheckinDraft {
  /** An app-login email waiting for the patient's YES before anything is created. */
  pendingEmail?: string;
  pain?: number;
  sleep?: number;
  energy?: number;
  /** Anything the patient wrote along the way, in their own words. */
  notes?: string[];
  /** How many times in a row the current question has not been understood. */
  misses?: number;
  /** A "log a change" update: pain and what changed only, saved alongside today's check-in. */
  update?: boolean;
  /** They tapped "Ask a question": the next message is the question for Justin. */
  awaitingQuestion?: boolean;
  /** They tapped "Change check-in time": the next message is the time. */
  awaitingTime?: boolean;
  /** Onboarding schedule: which question is open, and the frequency picked. */
  scheduleStep?: "frequency" | "time";
  scheduleId?: string;
  /** Self sign-up from a practice link: which practice, and the name they gave. */
  signupPracticeId?: string;
  signupName?: string;
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
  /**
   * A personal link to the consent page, minted by the worker whenever consent
   * is missing. Absent only if links can't be made yet (migration not
   * applied), in which case consent falls back to buttons in the chat.
   */
  consentUrl?: string;
  /** A client invite code was just used: welcome them by practice name. */
  inviteWelcome?: { practiceName: string };
  /** A join code was sent that doesn't work (expired, revoked, unknown). */
  inviteInvalid?: boolean;
  /** Self sign-up in progress or starting from a practice link (no profile yet). */
  signup?: {
    practiceId: string;
    practiceName: string;
    practitioners: PractitionerOption[];
    /** Who "Not sure" goes to: the practice owner. */
    fallback: PractitionerOption;
  };
  /** They have a Buddy app login already. */
  hasAppAccount?: boolean;
  /**
   * A personal "connect your watch" page link, for patients with no app login
   * (they can't get past the app's sign-in page). Absent: the app link.
   */
  watchUrl?: string;
  /** Eligible for the one-time app offer (no app login, not offered before). */
  appOfferDue?: boolean;
  /** History for Buddy's voice (voice.ts). Absent: the plain fixed wording. */
  voice?: Omit<VoiceContext, "firstName" | "now">;
  assist?: AiAssist;
  /** What a non-answer message is for, from the AI router. Keywords when absent. */
  route?: AssistRoute;
  /** The patient's own trend, worked out by the worker when they ask. */
  progressText?: string;
  /**
   * The conversational fallback's reading of a message that fits no fixed
   * path (AI consent only). Absent: the fixed replies are used.
   */
  converse?: ConverseResult;
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
  /** Self sign-up finished: create this profile and link the number to it. */
  createClient?: { fullName: string; practitionerId: string; practiceId: string };
  /** Set up a Buddy app login with this email. The worker writes the reply. */
  accountEmail?: string;
  markAppOffered?: boolean;
  /** "HH:MM", South African time. The patient asked to be checked in at this time. */
  setReminderTime?: string;
  /** A clinical question Buddy will not answer. Justin is alerted with it. */
  clinicalQuestion?: string;
  /** How often and when to check in (onboarding, or "only weekdays"). Time absent = keep it. */
  setSchedule?: { days: number[]; frequency: "daily" | "custom"; time?: string };
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
  askPainRetry2:
    "Just a single number please, from 0 (no pain) to 10 (worst pain imaginable). For example: 4",
  painGiveUp:
    "No problem, let's leave it for now. I've passed on what you wrote to your physiotherapist. Reply CHECK IN whenever you're ready to try again.",
  skipQuestion: "No problem, let's skip that one.",
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
  appAlready:
    "You already have a Buddy app login. Open the app and sign in with your email: https://peakbuddy.lovable.app/client/login",
  wearableLinkDirect: (url: string) =>
    "Great. Tap this link and pick your device. You'll sign in with your Garmin, Oura or Polar account, not Buddy:\n\n" +
    url +
    "\n\nIt only takes a minute.",
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
const PAIN_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  nul: 0,
  een: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vyf: 5,
  ses: 6,
  sewe: 7,
  agt: 8,
  nege: 9,
  tien: 10,
};
const PAIN_WORD_RE = new RegExp(`\\b(${Object.keys(PAIN_WORDS).join("|")})\\b`, "g");

export function readPain(msg: InboundForDecision): number | null {
  const r = extractDeterministic({ text: msg.text, replyId: msg.replyId, expecting: "painScore" });
  if (r.painScore !== null) return r.painScore;
  const text = msg.text ?? "";
  // "3 out of 10", "about 4 of 10"
  const outOf = text.match(/(?<!\d)(\d{1,2})\s*(?:out of|of)\s*10\b/i);
  if (outOf) return Number(outOf[1]) <= 10 ? Number(outOf[1]) : null;
  // "six", "about a seven" (words only, when no digits were typed)
  // Short answers only, so "one more thing, my knee..." is not read as a 1.
  if (!/\d/.test(text) && text.trim().split(/\s+/).length <= 5) {
    const words = text.toLowerCase().match(PAIN_WORD_RE) ?? [];
    const uniq = [...new Set(words)];
    if (uniq.length === 1) return PAIN_WORDS[uniq[0]];
  }
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

const wearableLinkReply = (ctx: DecisionContext): Reply =>
  text(ctx.watchUrl ? MSG.wearableLinkDirect(ctx.watchUrl) : MSG.wearableLink);

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

const menuList = (body: string): Reply => ({
  kind: "list",
  body,
  buttonLabel: "See options",
  rows: MENU.map((m) => ({ id: m.id, title: m.title, description: m.description })),
});

/** A bare time, for when we have just asked "what time?": 7am, 07:00, 18h30, 6 pm. */
export function readBareTime(text: string): string | null {
  const m = text
    .trim()
    .match(/^(?:at\s*)?(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?[.!]*$/i);
  if (!m) return null;
  return readReminderTime(`remind me at ${m[1]}${m[2] ? `:${m[2]}` : ""}${m[3] ? ` ${m[3]}` : ""}`);
}

const practitionerList = (body: string, s: NonNullable<DecisionContext["signup"]>): Reply => ({
  kind: "list",
  body,
  buttonLabel: "Choose",
  rows: [
    ...s.practitioners.slice(0, 9).map((p) => ({ id: `prac_${p.id}`, title: p.name.slice(0, 24) })),
    { id: "prac_unsure", title: "Not sure" },
  ],
});

const askNotes = (body: string = MSG.askNotes): Reply => ({
  kind: "buttons",
  body,
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

/* ------------------------------------------------------------------ */
/* Onboarding: how often and when                                      */
/* ------------------------------------------------------------------ */

export const frequencyList = (body: string): Reply => ({
  kind: "list",
  body,
  buttonLabel: "Choose",
  rows: FREQUENCIES.map((f) => ({ id: f.id, title: f.title })),
});

const timeList = (body: string): Reply => ({
  kind: "list",
  body,
  buttonLabel: "Choose",
  rows: TIMES.map((t) => ({ id: t.id, title: t.title })),
});

function scheduleDone(
  ctx: DecisionContext,
  choice: ScheduleChoice,
  time: string,
  fallback = false,
): Decision {
  const said = text(
    fallback
      ? SCHEDULE_MSG.fallback(choice.phrase, time)
      : SCHEDULE_MSG.confirmed(choice.phrase, time),
  );
  const first = startCheckin(ctx, [said]);
  return {
    ...first,
    setSchedule: { days: choice.days, frequency: choice.frequency, time },
  };
}

const vc = (ctx: DecisionContext): VoiceContext => ({
  firstName: ctx.client?.firstName ?? "there",
  now: ctx.now,
  ...ctx.voice,
});

function startCheckin(ctx: DecisionContext, lead: Reply[], seedNotes: string[] = []): Decision {
  if (ctx.checkedInToday) {
    return { replies: [...lead, text(MSG.alreadyToday)], next: IDLE() };
  }
  return {
    replies: [
      ...lead,
      text(ctx.voice ? opener(vc(ctx)) : MSG.checkinOpener(ctx.client!.firstName)),
      text(ctx.voice ? painQuestion(vc(ctx)) : MSG.askPain),
    ],
    next: { state: "awaiting_pain", draft: { notes: seedNotes }, checkinStartedAt: ctx.now },
  };
}

function withSafety(decision: Decision, ctx: DecisionContext): Decision {
  const safety = safetyReply(ctx.redFlags);
  if (!safety) return decision;
  if (ctx.redFlags.urgency === "emergency") {
    // An emergency ends the check-in. The only thing that matters now is the
    // safety message, and a pain question after "call an ambulance" is wrong.
    // Keep what they already told us: a pain score given before the emergency
    // is saved (flagged) rather than lost. Offers are never left half-made.
    const d = { ...ctx.conversation.draft, ...decision.next.draft };
    const partial =
      !decision.saveCheckin && typeof d.pain === "number"
        ? {
            pain: d.pain,
            sleep: d.sleep ?? null,
            energy: d.energy ?? null,
            notes: [...(d.notes ?? []), ctx.message.text ?? ""].filter(Boolean).join("\n"),
            flagged: true,
          }
        : undefined;
    return {
      ...decision,
      replies: [text(safety)],
      next: IDLE(),
      saveCheckin: decision.saveCheckin ?? partial,
      markWearableOffered: undefined,
      markAppOffered: undefined,
    };
  }
  return { ...decision, replies: [text(safety), ...decision.replies] };
}

/** The question waiting for an answer, as the patient last saw it. */
function pendingQuestionReply(state: ConversationState, draft: CheckinDraft): Reply | null {
  if (state === "awaiting_pain") return text(draft.update ? ASSIST_MSG.changeAskPain : MSG.askPain);
  if (state === "awaiting_sleep") return askSleep();
  if (state === "awaiting_energy") return askEnergy();
  return null;
}

/** Wording of the pending question, for the conversational model's context. */
export function pendingQuestionText(state: ConversationState): string | null {
  if (state === "awaiting_pain") return MSG.askPain;
  if (state === "awaiting_sleep") return `${MSG.askSleep} (1 very poorly to 5 very well)`;
  if (state === "awaiting_energy") return `${MSG.askEnergy} (1 very low to 5 very high)`;
  return null;
}

/**
 * A conversational reply in the middle of a check-in: say something human
 * about what they said, do the one thing they asked for if it is safe to do
 * mid-check-in, then put the pending question back in front of them.
 */
function interjectMidCheckin(
  ctx: DecisionContext,
  state: ConversationState,
  draft: CheckinDraft,
  keepHere: ConversationSnapshot,
  raw: string,
): Decision | null {
  const c = ctx.converse;
  const again = pendingQuestionReply(state, draft);
  if (!c || !again) return null;
  const lead = c.reply ? [text(c.reply)] : [];
  switch (c.action) {
    case "clinical_question":
      return {
        replies: [text(ASSIST_MSG.clinical), again],
        next: keepHere,
        clinicalQuestion: raw.slice(0, 1000),
      };
    case "pause_checkin":
      // Keep what they've answered; the 12 hour stale rule clears it if they don't come back.
      return {
        replies: lead.length ? lead : [text(ASSIST_MSG.paused)],
        next: { ...keepHere, state: "idle" },
      };
    case "skip_question":
      if (state === "awaiting_sleep") {
        return { replies: [...lead, askEnergy()], next: { ...keepHere, state: "awaiting_energy" } };
      }
      if (state === "awaiting_energy") {
        return { replies: [...lead, askNotes()], next: { ...keepHere, state: "awaiting_notes" } };
      }
      return { replies: [...lead, again], next: keepHere };
    case "booking":
      return { replies: [...lead, text(ASSIST_MSG.booking), again], next: keepHere };
    case "exercises":
      return { replies: [...lead, text(ASSIST_MSG.exercises), again], next: keepHere };
    case "connect_wearable":
      return {
        replies: [...lead, wearableLinkReply(ctx), again],
        next: keepHere,
        markWearableOffered: true,
      };
    case "set_checkin_time":
      return c.time
        ? {
            replies: [text(MSG.reminderSet(c.time)), again],
            next: keepHere,
            setReminderTime: c.time,
          }
        : { replies: [...lead, again], next: keepHere };
    case "note_for_practitioner":
      // Their words already go into this check-in's notes.
      return { replies: [...lead, again], next: keepHere };
    default:
      return { replies: [...lead, again], next: keepHere };
  }
}

/**
 * A conversational reply outside a check-in: answer like a person, carry out
 * the one action, and bring it back to centre.
 */
function converseIdle(ctx: DecisionContext, raw: string): Decision | null {
  const c = ctx.converse;
  if (!c) return null;
  const lead = c.reply ? [text(c.reply)] : [];
  const nudge = ctx.checkedInToday ? [] : [text(ASSIST_MSG.checkinNudge)];
  switch (c.action) {
    case "clinical_question":
      return {
        replies: [text(ASSIST_MSG.clinical)],
        next: IDLE(),
        clinicalQuestion: raw.slice(0, 1000),
      };
    case "start_checkin":
      if (ctx.checkedInToday) return { replies: [...lead, text(MSG.alreadyToday)], next: IDLE() };
      return {
        replies: [
          ...(lead.length ? lead : [text(MSG.checkinOpener(ctx.client!.firstName))]),
          text(MSG.askPain),
        ],
        next: { state: "awaiting_pain", draft: { notes: [] }, checkinStartedAt: ctx.now },
      };
    case "log_change":
      if (!ctx.checkedInToday) {
        return {
          replies: [...lead, text(MSG.askPain)],
          next: { state: "awaiting_pain", draft: { notes: [] }, checkinStartedAt: ctx.now },
        };
      }
      return {
        replies: [...lead, text(ASSIST_MSG.changeAskPain)],
        next: {
          state: "awaiting_pain",
          draft: { notes: [], update: true },
          checkinStartedAt: ctx.now,
        },
      };
    case "booking":
      return { replies: [...lead, text(ASSIST_MSG.booking)], next: IDLE() };
    case "exercises":
      return { replies: [...lead, text(ASSIST_MSG.exercises), ...nudge], next: IDLE() };
    case "progress":
      return {
        replies: [...lead, text(ctx.progressText ?? ASSIST_MSG.progressNone), ...nudge],
        next: IDLE(),
      };
    case "menu":
      return {
        replies: [
          menuList(c.reply || ASSIST_MSG.menuIntro(ctx.client!.firstName, ctx.checkedInToday)),
        ],
        next: IDLE(),
      };
    case "connect_wearable":
      return {
        replies: [...lead, wearableLinkReply(ctx)],
        next: IDLE(),
        markWearableOffered: true,
      };
    case "set_checkin_time":
      return c.time
        ? { replies: [text(MSG.reminderSet(c.time))], next: IDLE(), setReminderTime: c.time }
        : {
            replies: [...lead, text(ASSIST_MSG.askTime)],
            next: { state: "idle", draft: { awaitingTime: true }, checkinStartedAt: null },
          };
    case "note_for_practitioner":
      return {
        replies: [...lead, ...nudge],
        next: IDLE(),
        noteForPractitioner: raw.slice(0, 1000),
      };
    case "practice_info":
    default:
      return { replies: [...lead, ...nudge], next: IDLE() };
  }
}

export function decide(ctx: DecisionContext): Decision {
  const { message: msg, conversation: conv } = ctx;
  const raw = (msg.text ?? "").trim();

  // 1. No profile for this number (yet). Nothing is recorded anywhere clinical.
  if (!ctx.client) {
    const safety = safetyReply(ctx.redFlags);
    const safe = safety ? [text(safety)] : [];
    if (ctx.inviteInvalid) {
      return { replies: [...safe, text(ONBOARD_MSG.inviteInvalid)], next: IDLE("unmatched") };
    }
    const s = ctx.signup;
    if (s) {
      // Self sign-up from a practice link: name, then practitioner, then a profile.
      if (conv.state === "awaiting_practitioner" && conv.draft.signupName) {
        const pick: PractitionerOption | null =
          msg.replyId === "prac_unsure"
            ? s.fallback
            : msg.replyId?.startsWith("prac_")
              ? (s.practitioners.find((p) => `prac_${p.id}` === msg.replyId) ?? null)
              : matchPractitioner(raw, s.practitioners);
        if (!pick) {
          return {
            replies: [...safe, practitionerList(ONBOARD_MSG.practitionerRetry, s)],
            next: conv,
          };
        }
        const name = conv.draft.signupName;
        return {
          replies: [...safe, text(ONBOARD_MSG.linked(name.split(" ")[0], pick.name))],
          next: IDLE("new"),
          createClient: { fullName: name, practitionerId: pick.id, practiceId: s.practiceId },
        };
      }
      if (conv.state === "awaiting_name") {
        const name = readName(raw);
        if (!name) return { replies: [...safe, text(ONBOARD_MSG.nameRetry)], next: conv };
        return {
          replies: [...safe, practitionerList(ONBOARD_MSG.askPractitioner(name.split(" ")[0]), s)],
          next: {
            state: "awaiting_practitioner",
            draft: { signupPracticeId: s.practiceId, signupName: name },
            checkinStartedAt: null,
          },
        };
      }
      return {
        replies: [...safe, text(ONBOARD_MSG.practiceWelcome(s.practiceName))],
        next: {
          state: "awaiting_name",
          draft: { signupPracticeId: s.practiceId },
          checkinStartedAt: null,
        },
      };
    }
    return { replies: [...safe, text(MSG.unmatched)], next: IDLE("unmatched") };
  }
  const firstName = ctx.client.firstName;

  // 2. Opted out. Only START does anything. Silence otherwise: they asked us
  //    to stop. Red flags still alert the practitioner (handled by the caller),
  //    and the safety message still goes out, because silence after "I can't
  //    feel my legs" is not respect for an opt-out.
  if (conv.state === "opted_out") {
    if (START.test(raw)) {
      return {
        replies: [
          ctx.consentUrl
            ? text(ONBOARD_MSG.consentLink(firstName, ctx.consentUrl))
            : consentPrompt(firstName),
        ],
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

  // 4. Consent before anything is collected. Everyone is checked, existing
  //    profiles included: no current signed consent, no check-in, just the
  //    personal link to the consent page.
  const welcome = ctx.inviteWelcome
    ? [text(ONBOARD_MSG.inviteWelcome(firstName, ctx.inviteWelcome.practiceName))]
    : [];
  if (!ctx.hasConsent && ctx.consentUrl) {
    const body =
      conv.state === "awaiting_consent" && !ctx.inviteWelcome
        ? ONBOARD_MSG.consentReminder(ctx.consentUrl)
        : ONBOARD_MSG.consentLink(firstName, ctx.consentUrl);
    return withSafety({ replies: [...welcome, text(body)], next: IDLE("awaiting_consent") }, ctx);
  }
  if (ctx.hasConsent && ctx.inviteWelcome) {
    return withSafety(startCheckin(ctx, welcome), ctx);
  }
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
  // While a pain, sleep or energy question is open, only an explicit request
  // counts ("remind me at 7", "change my check-in time to 6pm"), so "knee at 5
  // today" is not read as a new reminder time.
  const midQuestion =
    conv.state === "awaiting_pain" ||
    conv.state === "awaiting_sleep" ||
    conv.state === "awaiting_energy";
  const reminder =
    conv.state === "awaiting_notes" ||
    (midQuestion && !/\b(remind|reminder|change|move|set|every day|daily)\b/i.test(raw))
      ? null
      : readReminderTime(raw);
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
        const human = interjectMidCheckin(ctx, state, draft, keep({ notes }, "awaiting_pain"), raw);
        if (human) return withSafety(human, ctx);
        const misses = (draft.misses ?? 0) + 1;
        if (misses >= 3) {
          // Don't loop. Pause, pass on what they wrote, and let them come back.
          const said = (notes ?? []).join(" | ").slice(0, 1000);
          return withSafety(
            {
              replies: [text(MSG.painGiveUp)],
              next: IDLE(),
              noteForPractitioner: said || undefined,
            },
            ctx,
          );
        }
        return withSafety(
          {
            replies: [text(misses >= 2 ? MSG.askPainRetry2 : MSG.askPainRetry)],
            next: keep({ notes, misses }, "awaiting_pain"),
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
          replies: [ctx.voice ? askSleep(afterPain(vc(ctx), pain)) : askSleep()],
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
        const human = interjectMidCheckin(
          ctx,
          state,
          draft,
          keep({ notes }, "awaiting_sleep"),
          raw,
        );
        if (human) return withSafety(human, ctx);
        if ((draft.misses ?? 0) >= 1) {
          // Second miss: skip this one rather than ask a third time.
          return withSafety(
            {
              replies: [text(MSG.skipQuestion), askEnergy()],
              next: keep({ notes, sleep: undefined, misses: 0 }, "awaiting_energy"),
            },
            ctx,
          );
        }
        return withSafety(
          {
            replies: [askSleep(MSG.askSleepRetry)],
            next: keep({ notes, misses: (draft.misses ?? 0) + 1 }, "awaiting_sleep"),
          },
          ctx,
        );
      }
      return withSafety(
        {
          replies: [ctx.voice ? askEnergy(afterSleep(vc(ctx))) : askEnergy()],
          next: keep({ sleep, misses: 0 }, "awaiting_energy"),
        },
        ctx,
      );
    }

    case "awaiting_energy": {
      const energy = readScale(msg, "wenergy_") ?? ctx.assist?.energy ?? null;
      if (energy === null) {
        const notes = raw ? [...(draft.notes ?? []), raw] : draft.notes;
        const human = interjectMidCheckin(
          ctx,
          state,
          draft,
          keep({ notes }, "awaiting_energy"),
          raw,
        );
        if (human) return withSafety(human, ctx);
        if ((draft.misses ?? 0) >= 1) {
          // Second miss: skip this one rather than ask a third time.
          return withSafety(
            {
              replies: [text(MSG.skipQuestion), askNotes()],
              next: keep({ notes, energy: undefined, misses: 0 }, "awaiting_notes"),
            },
            ctx,
          );
        }
        return withSafety(
          {
            replies: [askEnergy(MSG.askEnergyRetry)],
            next: keep({ notes, misses: (draft.misses ?? 0) + 1 }, "awaiting_energy"),
          },
          ctx,
        );
      }
      return withSafety(
        {
          replies: [ctx.voice ? askNotes(afterEnergy(vc(ctx))) : askNotes()],
          next: keep({ energy, misses: 0 }, "awaiting_notes"),
        },
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
      // One offer per check-in: the watch first, the app on a later one.
      const appOffer = !offer && Boolean(ctx.appOfferDue);
      const savedMsg = text(
        ctx.voice
          ? savedLine({
              ...vc(ctx),
              streak: (ctx.voice.streak ?? 0) + (ctx.checkedInToday ? 0 : 1),
            })
          : MSG.saved,
      );
      const decision: Decision = {
        replies: offer
          ? [savedMsg, wearableOffer()]
          : appOffer
            ? [savedMsg, text(ONBOARD_MSG.appOffer)]
            : [savedMsg],
        next: offer
          ? { state: "awaiting_wearable", draft: {}, checkinStartedAt: ctx.now }
          : appOffer
            ? { state: "awaiting_email", draft: {}, checkinStartedAt: ctx.now }
            : IDLE(),
        markWearableOffered: offer || undefined,
        markAppOffered: appOffer || undefined,
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

    case "awaiting_email": {
      const email = looksLikeEmail(raw);
      if (email) {
        // Read it back first: a typo would send their login link to a stranger.
        return withSafety(
          {
            replies: [text(ONBOARD_MSG.appConfirm(email))],
            next: { ...conv, draft: { ...conv.draft, pendingEmail: email } },
          },
          ctx,
        );
      }
      if (conv.draft.pendingEmail && (YES.test(raw) || msg.replyId === "app_email_yes")) {
        return withSafety(
          { replies: [], next: IDLE(), accountEmail: conv.draft.pendingEmail },
          ctx,
        );
      }
      if (NO.test(raw) || /^(no thanks|not now|maybe later|later)[.!]*$/i.test(raw)) {
        return withSafety({ replies: [text(ONBOARD_MSG.appDeclined)], next: IDLE() }, ctx);
      }
      if (/@/.test(raw) && raw.length < 80) {
        return withSafety({ replies: [text(ONBOARD_MSG.appAskAgain)], next: conv }, ctx);
      }
      // Something else entirely. Drop the offer and treat it as a fresh message.
      return decide({ ...ctx, conversation: IDLE() });
    }

    case "awaiting_schedule": {
      const d = conv.draft;
      const misses = d.misses ?? 0;
      if ((d.scheduleStep ?? "frequency") === "frequency") {
        const f = readFrequency(msg.replyId, raw);
        if (f) {
          return withSafety(
            {
              replies: [timeList(SCHEDULE_MSG.askTime)],
              next: {
                state: "awaiting_schedule",
                draft: { scheduleStep: "time", scheduleId: f.id },
                checkinStartedAt: ctx.now,
              },
            },
            ctx,
          );
        }
        if (misses >= 1)
          return withSafety(scheduleDone(ctx, FREQUENCIES[0], DEFAULT_TIME, true), ctx);
        return withSafety(
          {
            replies: [frequencyList(SCHEDULE_MSG.frequencyRetry)],
            next: { ...conv, draft: { ...d, misses: misses + 1 } },
          },
          ctx,
        );
      }
      const choice = FREQUENCIES.find((f) => f.id === d.scheduleId) ?? FREQUENCIES[0];
      const picked =
        TIMES.find((t) => t.id === msg.replyId)?.time ?? readBareTime(raw) ?? readReminderTime(raw);
      if (picked) return withSafety(scheduleDone(ctx, choice, picked), ctx);
      if (misses >= 1) return withSafety(scheduleDone(ctx, choice, DEFAULT_TIME, true), ctx);
      return withSafety(
        {
          replies: [timeList(SCHEDULE_MSG.timeRetry)],
          next: { ...conv, draft: { ...d, misses: misses + 1 } },
        },
        ctx,
      );
    }

    case "awaiting_wearable": {
      if (msg.replyId === IDS.wearableYes || YES.test(raw) || WEARABLE_REQUEST.test(raw)) {
        return withSafety({ replies: [wearableLinkReply(ctx)], next: IDLE() }, ctx);
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
          { replies: [wearableLinkReply(ctx)], next: IDLE(), markWearableOffered: true },
          ctx,
        );
      }
      if (CHECKIN_REQUEST.test(raw)) return withSafety(startCheckin(ctx, []), ctx);
      {
        const asksSchedule = /\b(check[\s-]?ins?|remind\w*|message me)\b|^only\b/i.test(raw);
        const f = asksSchedule ? readFrequency(undefined, raw) : null;
        if (f) {
          const t = readReminderTime(raw) ?? readBareTime(raw);
          return withSafety(
            {
              replies: [
                text(
                  t
                    ? SCHEDULE_MSG.confirmed(f.phrase, t).split("\n\n")[0]
                    : `Done, I'll check in ${f.phrase} from now on, at your usual time.`,
                ),
              ],
              next: IDLE(),
              setSchedule: { days: f.days, frequency: f.frequency, ...(t ? { time: t } : {}) },
            },
            ctx,
          );
        }
      }
      if (/^(app|the app|buddy app|get the app)[.!?]*$/i.test(raw)) {
        return withSafety(
          ctx.hasAppAccount
            ? { replies: [text(MSG.appAlready)], next: IDLE() }
            : {
                replies: [text(ONBOARD_MSG.appOffer)],
                next: { state: "awaiting_email", draft: {}, checkinStartedAt: ctx.now },
                markAppOffered: true,
              },
          ctx,
        );
      }

      // Follow-ups to a menu choice made in the previous message.
      if (conv.draft.awaitingQuestion && raw && !msg.replyId) {
        return withSafety(
          {
            replies: [text(ASSIST_MSG.clinical)],
            next: IDLE(),
            clinicalQuestion: raw.slice(0, 1000),
          },
          ctx,
        );
      }
      if (conv.draft.awaitingTime && !msg.replyId) {
        const t = readBareTime(raw);
        if (t) {
          return withSafety(
            { replies: [text(MSG.reminderSet(t))], next: IDLE(), setReminderTime: t },
            ctx,
          );
        }
      }

      // Menu items that are not a routing intent of their own.
      switch (msg.replyId) {
        case "menu_info":
          return withSafety({ replies: [text(PRACTICE_SUMMARY)], next: IDLE() }, ctx);
        case "menu_question":
          return withSafety(
            {
              replies: [text(ASSIST_MSG.askQuestion)],
              next: { state: "idle", draft: { awaitingQuestion: true }, checkinStartedAt: null },
            },
            ctx,
          );
        case "menu_time":
          return withSafety(
            {
              replies: [text(ASSIST_MSG.askTime)],
              next: { state: "idle", draft: { awaitingTime: true }, checkinStartedAt: null },
            },
            ctx,
          );
        case "menu_watch":
          return withSafety(
            { replies: [wearableLinkReply(ctx)], next: IDLE(), markWearableOffered: true },
            ctx,
          );
        default:
          break;
      }

      // Questions and requests get answered rather than turned into a check-in.
      const route = routeFromMenu(msg.replyId) ?? ctx.route ?? routeByKeywords(raw);
      const nudge = ctx.checkedInToday ? [] : [text(ASSIST_MSG.checkinNudge)];
      switch (route.intent) {
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
        case "help":
          return withSafety(
            {
              replies: [menuList(ASSIST_MSG.menuIntro(ctx.client!.firstName, ctx.checkedInToday))],
              next: IDLE(),
            },
            ctx,
          );
        case "greeting":
          // Hello after today's check-in: say hello back and show what else Buddy does.
          if (ctx.checkedInToday) {
            return withSafety(
              {
                replies: [menuList(ASSIST_MSG.menuIntro(ctx.client!.firstName, true))],
                next: IDLE(),
              },
              ctx,
            );
          }
          break;
        default:
          break;
      }

      // Nothing fixed fits: talk like a person and bring it back to centre.
      const human = converseIdle(ctx, raw);
      if (human) return withSafety(human, ctx);

      // Idle. Any message starts today's check-in, unless it is already done,
      // in which case what they wrote is a note for the practitioner.
      if (ctx.checkedInToday) {
        const isChitChat =
          !raw || /^(hi|hello|hey|hallo|thanks|thank you|dankie|ok|okay)[.!]*$/i.test(raw);
        // A short question we couldn't place is asked back, not silently filed
        // as a note. (Idea from Lovable's pass on 5 Oct.)
        const isUnplacedQuestion =
          !isChitChat && /\?\s*$/.test(raw) && raw.length < 120 && !ctx.redFlags.triggered;
        if (isUnplacedQuestion) {
          return withSafety({ replies: [text(ASSIST_MSG.clarify)], next: IDLE() }, ctx);
        }
        return withSafety(
          {
            replies: [text(isChitChat ? MSG.alreadyToday : ASSIST_MSG.noteAddedMenu)],
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
