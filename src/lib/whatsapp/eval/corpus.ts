/**
 * Hand-written messy WhatsApp turns. Expected fields are specified here.
 * The scorer does not invent them from the parser.
 */

export interface ExtractCase {
  kind: "extract";
  id: string;
  text: string;
  replyId?: string;
  quoted?: string;
  pending?: "pain" | "sleep" | "energy" | "stress" | "adherence" | "notes";
  pain?: number | null;
  sleep?: number | null;
  energy?: number | null;
  stress?: number | null;
  adherence?: "all" | "most" | "some" | "none" | null;
  confirm?: boolean;
  defer?: "later" | "busy" | "tonight" | "soon" | null;
  distress?: boolean;
  aside?: "booking" | "appointment" | "programme" | "practice" | "clinical" | "pause" | "wearable" | "help" | null;
  ambiguous?: boolean;
  greeting?: boolean;
  correction?: number | null;
}

export interface TalkCase {
  kind: "talk";
  id: string;
  text: string;
  expect:
    | { fn: "replaced"; name: string | null }
    | { fn: "dropped"; name: "pronoun" | string | null }
    | { fn: "added"; names: string[] | null }
    | { fn: "follow"; value: "why" | "sleep" | "energy" | "pain" | "stress" | "others" | "summary" | null }
    | { fn: "handover"; action: "pause_buddy" | "resume_buddy" | null; name?: string }
    | { fn: "reaction"; id: "react_yes" | "react_no" | null }
    | { fn: "quote"; field: "pain" | "sleep" | "energy" | "stress" | "adherence" | "notes" | null };
}

export type EvalCase = ExtractCase | TalkCase;

const e = (row: Omit<ExtractCase, "kind">): ExtractCase => ({ kind: "extract", ...row });
const t = (row: Omit<TalkCase, "kind">): TalkCase => ({ kind: "talk", ...row });

export const EVAL_CASES: EvalCase[] = [
  e({ id: "p1", text: "pain 4", pain: 4, confirm: false, adherence: null }),
  e({ id: "p2", text: "about a 5", pain: 5, confirm: false }),
  e({ id: "p3", text: "10", pain: 10 }),
  e({ id: "p4", text: "worst", pain: 10 }),
  e({ id: "p5", text: "pain is worst", pain: 10, confirm: true }),
  e({ id: "p6", text: "knee is kak", pain: 8, confirm: true }),
  e({ id: "p7", text: "sharp", pain: null, greeting: true }),
  e({ id: "p8", text: "howzit", greeting: true, pain: null }),
  e({ id: "p9", text: "ja nee", greeting: true, pain: null }),
  e({ id: "p10", text: "lekker", greeting: true, pain: null }),
  e({ id: "p11", text: "😭", pain: 10, confirm: true }),
  e({ id: "p12", text: "slept badly", sleep: 2, confirm: true, pain: null }),
  e({ id: "p13", text: "didn't sleep", sleep: 1, confirm: true }),
  e({ id: "p14", text: "slept like a baby", sleep: 5, confirm: true }),
  e({ id: "p15", text: "slept well", sleep: 4, confirm: true }),
  e({ id: "p16", text: "energy low", energy: 2, confirm: true }),
  e({ id: "p17", text: "no energy", energy: 1, confirm: true }),
  e({ id: "p18", text: "tired", energy: 2, confirm: true }),
  e({ id: "p19", text: "very stressed", stress: 5, confirm: true }),
  e({ id: "p20", text: "stressed", stress: 4, confirm: true }),
  e({ id: "p21", text: "calm", stress: 2, confirm: true }),
  e({ id: "p22", text: "did them all", adherence: "all", confirm: true, pain: null }),
  e({ id: "p23", text: "did most of the exercises", adherence: "most", confirm: true }),
  e({ id: "p24", text: "some of them", adherence: "some", confirm: true }),
  e({ id: "p25", text: "didn't do any", adherence: "none", confirm: true }),
  e({ id: "p26", text: "nothing to add", adherence: null, pain: null }),
  e({ id: "p27", text: "later", defer: "later", pain: null }),
  e({ id: "p28", text: "busy now", defer: "busy" }),
  e({ id: "p29", text: "remind me tonight", defer: "tonight" }),
  e({ id: "p30", text: "just now", defer: "soon" }),
  e({ id: "p31", text: "now now", defer: "soon" }),
  e({ id: "p32", text: "not coping", distress: true, pain: null }),
  e({ id: "p33", text: "can't cope", distress: true }),
  e({ id: "p34", text: "pain's down from 6", distress: false }),
  e({ id: "p35", text: "I meant 3", correction: 3, pain: null }),
  e({ id: "p36", text: "pain was 5 not 6", correction: 5, pain: 5 }),
  e({ id: "p37", text: "4 and 6", ambiguous: true, pain: null }),
  e({ id: "p38", text: "can I move thursday", aside: "booking" }),
  e({ id: "p39", text: "should I ice it", aside: "clinical" }),
  e({ id: "p40", text: "what time do you close", aside: "practice" }),
  e({ id: "p41", text: "what exercises do I have", aside: "programme" }),
  e({ id: "p42", text: "connect my watch", aside: "wearable" }),
  e({ id: "p43", text: "help", aside: "help" }),
  e({ id: "p44", text: "stop for now", aside: "pause" }),
  e({ id: "p45", text: "eish this bot is useless", pain: null }),
  e({ id: "p46", text: "pain 4 sleep 3 energy 2 stress 1", pain: 4, sleep: 3, energy: 2, stress: 1, confirm: true }),
  e({ id: "p47", text: "pain drie", pain: 3, confirm: true }),
  e({ id: "p48", text: "pain 0", pain: 0, confirm: false }),
  e({ id: "p49", text: "no pain", pain: 0, confirm: true }),
  e({ id: "p50", text: "7/10", pain: 7 }),
  e({ id: "p51", text: "", replyId: "pain_7", pain: 7, confirm: false }),
  e({ id: "p52", text: "", replyId: "adh_most", adherence: "most", confirm: false }),
  e({ id: "p53", text: "3", pending: "sleep", sleep: 3, pain: null }),
  e({ id: "p54", text: "kak", pending: "pain", pain: 8, confirm: true }),
  e({ id: "p55", text: "baie sleg", sleep: 1, confirm: true }),
  e({ id: "p56", text: "sleg geslaap", sleep: 2, confirm: true }),
  e({ id: "p57", text: "when is my next appointment", aside: "appointment" }),
  e({ id: "p58", text: "I'm so frustrated", pain: null }),
  e({ id: "p59", text: "skipped them", adherence: "none", confirm: true }),
  e({ id: "p60", text: "the whole programme", adherence: "all", confirm: true }),
  e({ id: "p61", text: "overwhelmed", stress: 5, confirm: true }),
  e({ id: "p62", text: "chilled", stress: 2, confirm: true }),
  e({ id: "p63", text: "very calm", stress: 1, confirm: true }),
  e({ id: "p64", text: "pain lekker", pain: 2, confirm: true }),
  e({ id: "p65", text: "4", quoted: "How was your sleep?", sleep: 4, pain: null }),
  e({ id: "p66", text: "hello", greeting: true, pain: null }),
  e({ id: "p67", text: "dankie", greeting: true }),
  e({ id: "p68", text: "not now", defer: "later" }),
  e({ id: "p69", text: "I'm busy", defer: "busy" }),
  e({ id: "p70", text: "feel hopeless", distress: true }),
  e({ id: "p71", text: "breaking down", distress: true }),
  e({ id: "p72", text: "pain ten", pain: 10, confirm: true }),
  e({ id: "p73", text: "a few exercises", adherence: "some", confirm: true }),
  e({ id: "p74", text: "majority of the programme", adherence: "most", confirm: true }),
  e({ id: "p75", text: "2 and 4", ambiguous: true }),
  e({ id: "p76", text: "make it 2", pending: "energy", correction: 2 }),
  e({ id: "p77", text: "energy 5", energy: 5, confirm: false }),
  e({ id: "p78", text: "stress 2", stress: 2, confirm: false }),
  e({ id: "p79", text: "sleep 1", sleep: 1, confirm: false }),
  e({ id: "p80", text: "🙂", pain: 2, confirm: true }),
  t({ id: "r1", text: "no I meant Lauren", expect: { fn: "replaced", name: "lauren" } }),
  t({ id: "r2", text: "I meant Steven Jacobs", expect: { fn: "replaced", name: "steven jacobs" } }),
  t({ id: "r3", text: "actually not her", expect: { fn: "dropped", name: "pronoun" } }),
  t({ id: "r4", text: "not Lauren", expect: { fn: "dropped", name: "lauren" } }),
  t({ id: "r5", text: "and Steven too", expect: { fn: "added", names: ["steven"] } }),
  t({ id: "r6", text: "also Vicki", expect: { fn: "added", names: ["vicki"] } }),
  t({ id: "r7", text: "not her too", expect: { fn: "added", names: null } }),
  t({ id: "r8", text: "and her sleep?", expect: { fn: "follow", value: "sleep" } }),
  t({ id: "r9", text: "why", expect: { fn: "follow", value: "why" } }),
  t({ id: "r10", text: "hoekom", expect: { fn: "follow", value: "why" } }),
  t({ id: "r11", text: "what about the others", expect: { fn: "follow", value: "others" } }),
  t({ id: "r12", text: "summarise", expect: { fn: "follow", value: "summary" } }),
  t({ id: "r13", text: "and her energy?", expect: { fn: "follow", value: "energy" } }),
  t({ id: "r14", text: "and her pain?", expect: { fn: "follow", value: "pain" } }),
  t({ id: "r15", text: "and her stress?", expect: { fn: "follow", value: "stress" } }),
  t({ id: "r16", text: "I'll take Lauren", expect: { fn: "handover", action: "pause_buddy", name: "lauren" } }),
  t({ id: "r17", text: "hand Lauren back", expect: { fn: "handover", action: "resume_buddy", name: "lauren" } }),
  t({ id: "r18", text: "pause buddy for Cayla", expect: { fn: "handover", action: "pause_buddy", name: "cayla" } }),
  t({ id: "r19", text: "resume buddy for Cayla", expect: { fn: "handover", action: "resume_buddy", name: "cayla" } }),
  t({ id: "r20", text: "👍", expect: { fn: "reaction", id: "react_yes" } }),
  t({ id: "r21", text: "👎", expect: { fn: "reaction", id: "react_no" } }),
  t({ id: "r22", text: "❤️", expect: { fn: "reaction", id: null } }),
  t({ id: "r23", text: "How is your pain today?", expect: { fn: "quote", field: "pain" } }),
  t({ id: "r24", text: "How did you sleep?", expect: { fn: "quote", field: "sleep" } }),
  t({ id: "r25", text: "How is your energy?", expect: { fn: "quote", field: "energy" } }),
  t({ id: "r26", text: "How stressed are you?", expect: { fn: "quote", field: "stress" } }),
  t({ id: "r27", text: "How much of the home exercise programme did you do?", expect: { fn: "quote", field: "adherence" } }),
  t({ id: "r28", text: "Anything else for your physio?", expect: { fn: "quote", field: "notes" } }),
  t({ id: "r29", text: "rather Michaela", expect: { fn: "replaced", name: "michaela" } }),
  t({ id: "r30", text: "how are my clients doing", expect: { fn: "added", names: null } }),
];
