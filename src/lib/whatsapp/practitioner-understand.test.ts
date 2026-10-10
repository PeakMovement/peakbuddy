/**
 * Messy practitioner WhatsApp. Every intent the staff actually type, plus
 * sentences that must not check a patient in, notice them about a programme,
 * or pass an errand to reception.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { handlePractitionerMessage, PRAC_MSG, smallTalk } from "./practitioner-mode.server";
import { practitionerIntent } from "./practitioner-status.server";
import { handleReceptionMessage, RECEPTION_MSG } from "./reception.server";
import {
  editDistance,
  normalizePractitionerText,
  programmeConfidence,
  rankPatients,
  readPracMemory,
  writePracMemory,
  type PracMemory,
} from "./practitioner-understand";

const NOW = new Date("2026-10-10T08:00:00Z");
const SAM = "11111111-1111-1111-1111-111111111111";
const LEE = "33333333-3333-3333-3333-333333333333";
const THEA = "44444444-4444-4444-4444-444444444444";
const SAM2 = "55555555-5555-5555-5555-555555555555";
const RECEPTION = "27600000099";

describe("normalising what staff actually type", () => {
  it.each([
    ["Contact reception", "contact reception"],
    ["msg front desk pls", "message front desk please"],
    ["tel recepton to call Thea", "tell reception to call thea"],
    ["hows my clints", "how's my clients"],
    ["how is sam doin", "how is sam doing"],
    ["chek in wit sam", "check in with sam"],
    ["any red flag", "any red flag"],
    ["whos quiet", "who's quiet"],
    ["send update evry morning", "send update every morning"],
    ["sent sam programe", "sent sam programme"],
    ["hw r my patints", "how are my patients"],
    ["chekin with Kruge", "check in with kruge"],
    ["progarmme for sam", "programme for sam"],
  ])("%s → %s", (raw, want) => {
    expect(normalizePractitionerText(raw)).toBe(want);
  });

  it("leaves real names alone", () => {
    for (const name of ["sam", "kruger", "thea", "lee", "adams", "petersen", "about", "there"]) {
      expect(normalizePractitionerText(`hello ${name}`)).toContain(name);
    }
  });

  it("edit distance", () => {
    expect(editDistance("sam", "sma")).toBe(1);
    expect(editDistance("reception", "recepton")).toBe(1);
    expect(editDistance("programme", "programe")).toBe(1);
    expect(editDistance("kruger", "quiet")).toBeGreaterThan(2);
  });
});

describe("intent, clear phrasing and messy phrasing", () => {
  it.each([
    ["How are my clients doing?", "status_all"],
    ["how's my patients", "status_all"],
    ["hows my clints", "status_all"],
    ["how is my clients", "status_all"],
    ["hw r my patints", "status_all"],
    ["clients status pls", "status_all"],
    ["status of my clients", "status_all"],
    ["how is everyone", "status_all"],
    ["client update", "status_all"],
    ["How is Sam Kruger doing?", "status_one"],
    ["how is sam doin", "status_one"],
    ["how's Sam getting on", "status_one"],
    ["hows sam", "status_one"],
    ["how is thea", "status_one"],
    ["update on sam", "status_one"],
    ["how is sma doing", "status_one"],
    ["Check in with Sam", "checkin"],
    ["chek in wit sam", "checkin"],
    ["checkin sam", "checkin"],
    ["pls check in on sam", "checkin"],
    ["nudge sam", "checkin"],
    ["Can you ask Sam Kruger to check in", "checkin"],
    ["sam needs a check in", "checkin"],
    ["sam check in pls", "checkin"],
    ["Any red flags?", "admin"],
    ["any red flag", "admin"],
    ["redflag?", "admin"],
    ["any redflags", "admin"],
    ["who's gone quiet", "admin"],
    ["whos quiet", "admin"],
    ["who is quiet", "admin"],
    ["whose quiet", "admin"],
    ["anyone gone quiet", "admin"],
    ["who hasnt been checking in", "admin"],
    ["quiet clints", "admin"],
    ["How many clients are using Buddy?", "admin"],
    ["how many clints", "admin"],
    ["buddy usage", "admin"],
    ["practice overview", "admin"],
    ["Update me daily", "updates"],
    ["send update evry morning", "updates"],
    ["update me every morning", "updates"],
    ["send me a weekly report", "updates"],
    ["morning updates", "updates"],
    ["update me every fridy at 6pm", "updates"],
    ["stop the updates", "updates"],
    ["stop sending me updates", "updates"],
    ["no more digests", "updates"],
    ["Ask reception to book Sam Kruger for Thursday afternoon", "reception"],
    ["tel recepton to call thea", "reception"],
    ["please ask the receptionist to send Lee an invoice.", "reception"],
    ["Tell the front desk that Ann needs a call back", "reception"],
    ["Reception: call Ann back about Friday", "reception"],
    ["contact reception to call Thea", "reception"],
    ["msg the front desk to send the invoice", "reception"],
    ["can you ask recepton to book thursday", "reception"],
    ["Contact reception", "reception_ask"],
    ["message reception", "reception_ask"],
    ["reception", "reception_ask"],
    ["msg front desk pls", "reception_ask"],
    ["text the receptionist", "reception_ask"],
    ["ping reception", "reception_ask"],
    ["can you contact reception", "reception_ask"],
    ["speak to front desk", "reception_ask"],
    ["reception please", "reception_ask"],
    ["reception call thea", "reception_confirm"],
    ["front desk book sam thursday", "reception_confirm"],
    ["can reception call thea tomorrow", "reception_confirm"],
    ["what's open with reception?", "reception_open"],
    ["whats outstanding at the front desk", "reception_open"],
    ["reception tasks", "reception_open"],
    ["any open reception requests", "reception_open"],
  ])("%s → %s", (text, kind) => {
    expect(practitionerIntent(text, null).kind).toBe(kind);
  });

  it("loose check-in is medium, a tidy one is not", () => {
    expect(practitionerIntent("chek in wit sam", null)).toEqual({
      kind: "checkin",
      clientId: null,
    });
    expect(practitionerIntent("sam needs a check in", null)).toMatchObject({
      kind: "checkin",
      confidence: "medium",
    });
    expect(practitionerIntent("sam check in pls", null)).toMatchObject({
      confidence: "medium",
    });
  });

  it("typo fixes still keep the errand", () => {
    expect(practitionerIntent("tel recepton to call Thea", null)).toEqual({
      kind: "reception",
      task: "Call Thea",
    });
    expect(practitionerIntent("send update evry morning", null)).toMatchObject({
      kind: "updates",
      frequency: "daily",
      time: "07:30",
    });
    expect(practitionerIntent("update me every fridy at 6pm", null)).toMatchObject({
      frequency: "weekly",
      weekday: 5,
      time: "18:00",
    });
    expect(practitionerIntent("whos quiet", null)).toEqual({ kind: "admin", topic: "quiet" });
    expect(practitionerIntent("any red flag", null)).toEqual({ kind: "admin", topic: "redflags" });
  });

  it("reception call thea asks before sending", () => {
    const intent = practitionerIntent("reception call thea", null);
    expect(intent).toMatchObject({ kind: "reception_confirm" });
    if (intent.kind === "reception_confirm") expect(intent.task.toLowerCase()).toContain("thea");
  });
});

describe("must not become an outbound action", () => {
  it.each([
    "thanks",
    "thank you",
    "ok",
    "okay",
    "perfect",
    "cheers",
    "hi",
    "hello",
    "good morning",
    "blue elephant",
    "reception is closed",
    "the reception area is lovely",
    "the programme is hard",
    "I saw sam yesterday",
    "don't check in with sam",
    "do not check in with sam",
    "haven't sent sam his programme",
    "did not send the programme",
    "call thea",
    "send the invoice",
    "quiet please",
    "update the website",
    "my clients are lovely",
    "check the door",
    "red shoes",
    "sam is doing well",
    "how's it going",
    "how is the weather",
    "book a table",
    "what's for lunch",
    "done 2",
    "what's open",
    "8",
    "my knee hurts",
    "about a 5",
    "don't update me daily",
    "don't ask reception to call thea",
    "never message reception",
    "not yet sent the programme",
  ])("%s", (text) => {
    const intent = practitionerIntent(text, null);
    expect(intent.kind).not.toBe("reception");
    expect(intent.kind).not.toBe("reception_confirm");
    if (intent.kind === "checkin") expect(intent.confidence).toBe("medium");
    expect(intent.kind === "checkin" && intent.confidence !== "medium").toBe(false);
    expect(programmeConfidence(text)).not.toBe("high");
  });

  it("programme typos are high only when they actually sent it", () => {
    expect(programmeConfidence("sent sam programe")).toBe("high");
    expect(programmeConfidence("I've sent Sam Kruger his programme")).toBe("high");
    expect(programmeConfidence("sam programe")).toBe("medium");
    expect(programmeConfidence("the programme is hard")).toBeNull();
    expect(programmeConfidence("haven't sent sam his programme")).toBeNull();
  });

  it("small talk is unchanged", () => {
    expect(smallTalk("thanks")).toBe("thanks");
    expect(smallTalk("Thank you so much")).toBe("thanks");
    expect(smallTalk("ok")).toBe("ack");
    expect(smallTalk("Perfect!")).toBe("ack");
    expect(smallTalk("Good morning")).toBe("greeting");
    expect(smallTalk("what can you do?")).toBe("help");
    expect(smallTalk("the knee one")).toBeNull();
  });
});

describe("fuzzy client names", () => {
  const list = [
    { id: "a", full_name: "Sam Kruger" },
    { id: "b", full_name: "Sam Petersen" },
    { id: "c", full_name: "Thea Nkosi" },
    { id: "d", full_name: "Lee Adams" },
    { id: "e", full_name: "Carl Meyer" },
  ];

  it("exact full name beats a shared first name", () => {
    expect(rankPatients("sent Sam Kruger his program", list).map((h) => h.patient.id)).toEqual([
      "a",
    ]);
    expect(rankPatients("sent Sam Kruger his program", list)[0].confidence).toBe("high");
  });

  it("two exact first names are a choice, not a guess", () => {
    const hits = rankPatients("how is sam doing", list);
    expect(hits.map((h) => h.patient.id).sort()).toEqual(["a", "b"]);
    expect(hits.every((h) => h.confidence === "high")).toBe(true);
  });

  it("sma is a medium Sam, kruge is Kruger, thea is exact", () => {
    const sma = rankPatients("how is sma doin", list);
    expect(sma.map((h) => h.patient.id).sort()).toEqual(["a", "b"]);
    expect(sma.every((h) => h.confidence === "medium")).toBe(true);
    expect(rankPatients("chek in wit kruge", list).map((h) => h.patient.id)).toEqual(["a"]);
    expect(rankPatients("chek in wit kruge", list)[0].confidence).toBe("medium");
    const thea = rankPatients("how is thea", list);
    expect(thea.map((h) => h.patient.id)).toEqual(["c"]);
    expect(thea[0].confidence).toBe("high");
  });

  it("does not fuzzy a task word onto a person", () => {
    expect(rankPatients("call thea", list).map((h) => h.patient.id)).toEqual(["c"]);
    expect(rankPatients("check the door", list)).toEqual([]);
    expect(rankPatients("the programme is hard", list)).toEqual([]);
  });
});

type Row = Record<string, any>;
function fakeDb(t: Record<string, Row[]>) {
  const from = (table: string) => {
    const f: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let upsertRow: Row | null = null;
    const rows = () => (t[table] ??= []).filter((r) => f.every((x) => x(r)));
    const done = () => {
      if (upsertRow) {
        const list = (t[table] ??= []);
        const i = list.findIndex((r) => r.practitioner_id === upsertRow!.practitioner_id);
        if (i >= 0) Object.assign(list[i], upsertRow);
        else list.push({ ...upsertRow });
        return { data: [upsertRow], error: null };
      }
      const hit = rows();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit, error: null };
    };
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), api),
      neq: (k: string, v: unknown) => (f.push((r) => r[k] !== v), api),
      in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), api),
      is: (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), api),
      gte: (k: string, v: string) => (f.push((r) => String(r[k]) >= v), api),
      gt: (k: string, v: string) => (f.push((r) => String(r[k]) > v), api),
      order: () => api,
      limit: () => (patch ? api : Promise.resolve(done())),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      update: (p: Row) => ((patch = p), api),
      upsert: (r: Row) => ((upsertRow = r), api),
      insert: (r: Row) => ((t[table] ??= []).push({ ...r }), Promise.resolve({ error: null })),
      then: (res: any, rej: any) => Promise.resolve(done()).then(res, rej),
    };
    return api;
  };
  return {
    from,
    t,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] } }),
        getUserById: async () => ({ data: { user: null } }),
      },
    },
  } as any;
}

const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function world(extraClients: Row[] = []) {
  return fakeDb({
    practices: [],
    practice_members: [],
    profiles: [{ id: "zoe", full_name: "Zoe Test", role: "practitioner" }],
    clients: [
      {
        id: SAM,
        full_name: "Sam Kruger",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysAgo(20),
        auth_user_id: null,
      },
      {
        id: LEE,
        full_name: "Lee Adams",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysAgo(20),
        auth_user_id: null,
      },
      {
        id: THEA,
        full_name: "Thea Nkosi",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysAgo(20),
        auth_user_id: null,
      },
      ...extraClients,
    ],
    check_ins: [
      {
        client_id: SAM,
        pain_level: 4,
        sleep_quality: 3,
        energy_level: 3,
        notes: null,
        created_at: daysAgo(1),
      },
      {
        client_id: LEE,
        pain_level: 2,
        sleep_quality: 4,
        energy_level: 4,
        notes: null,
        created_at: daysAgo(6),
      },
    ],
    alerts: [
      {
        client_id: SAM,
        alert_type: "red_flag",
        urgency: "urgent",
        created_at: daysAgo(0.2),
        message: "WhatsApp check-in: Pain rose 3 points since the last check-in (4 to 7)",
        is_read: false,
        reviewed_at: null,
      },
    ],
    whatsapp_conversations: [
      {
        id: "c1",
        client_id: SAM,
        phone: "27820000001",
        opted_out_at: null,
        state: "idle",
        draft: {},
      },
    ],
    whatsapp_inbound: [
      { from_phone: "+27820000001", received_at: daysAgo(0.05) },
      { from_phone: RECEPTION, received_at: daysAgo(0.05) },
    ],
    whatsapp_outbound: [],
    reception_requests: [],
    practitioner_update_prefs: [],
    practitioner_checkin_requests: [],
  });
}

function harness(db = world()) {
  const sent: any[] = [];
  const replies: any[] = [];
  const requestCheckin = vi.fn(async () => "sent" as const);
  const memory: PracMemory = {};
  const deps = {
    provider: {
      id: "meta",
      send: vi.fn(async (m: any) => (sent.push(m), { providerMessageId: "w" })),
    } as any,
    secrets: {} as any,
    now: NOW,
    requestCheckin,
    reply: async (m: any) => void replies.push(m),
  };
  const say = (text: string, replyId: string | null = null) =>
    handlePractitionerMessage(
      db,
      { userId: "zoe", firstName: "Zoe" },
      { text, replyId },
      deps,
      memory,
    );
  return { db, sent, replies, requestCheckin, memory, say };
}

describe("what Buddy does with a messy message", () => {
  afterEach(() => {
    delete process.env.WHATSAPP_RECEPTION_NUMBER;
    delete process.env.WHATSAPP_PROGRAMME_TEMPLATE;
  });

  it("bare contact reception asks, then the next line is the errand", async () => {
    process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
    const { db, say, replies, sent } = harness();
    await say("Contact reception");
    expect(replies[0].body).toBe(PRAC_MSG.receptionAsk);
    expect(db.t.reception_requests).toHaveLength(0);
    expect(sent).toHaveLength(0);
    await say("please call Thea about Thursday");
    expect(db.t.reception_requests).toHaveLength(1);
    expect(db.t.reception_requests[0].request_text).toMatch(/call Thea about Thursday/i);
    expect(sent[0].to).toBe(RECEPTION);
    expect(replies[1].body).toBe(RECEPTION_MSG.toPractitioner("sent"));
  });

  it("message reception and a bare reception do the same", async () => {
    const { say, replies, memory } = harness();
    await say("msg front desk pls");
    expect(replies[0].body).toBe("What should I pass on to reception?");
    expect(memory.awaitingReception).toBe(true);
    await say("reception");
    expect(replies.at(-1).body).toBe(PRAC_MSG.receptionAsk);
    expect(memory.awaitingReception).toBe(true);
  });

  it("thanks, ok, and a client question are not passed to reception", async () => {
    process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
    const { db, say, replies } = harness();
    await say("contact reception");
    await say("Thanks!");
    await say("reception");
    await say("ok");
    await say("message reception");
    await say("hows my clints");
    expect(db.t.reception_requests).toHaveLength(0);
    expect(replies[1].body).toMatch(/Zoe\.$/);
    expect(replies[3].body).toBe(PRAC_MSG.ack);
    expect(replies[5].body).toContain("Here's how your clients are doing");
  });

  it("cancel drops the errand", async () => {
    const { say, replies, memory } = harness();
    await say("reception");
    await say("never mind");
    expect(replies[1].body).toBe(PRAC_MSG.receptionCancelled);
    expect(memory.awaitingReception).toBe(false);
  });

  it("tel recepton to call thea is clear enough to send", async () => {
    process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
    const { db, say, replies } = harness();
    await say("tel recepton to call thea");
    expect(db.t.reception_requests[0].request_text).toBe("Call thea");
    expect(replies[0].body).toBe(RECEPTION_MSG.toPractitioner("sent"));
    expect(replies[0].kind).not.toBe("buttons");
  });

  it("reception call thea asks, and No sends nothing", async () => {
    process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
    const { db, say, replies } = harness();
    await say("reception call thea");
    expect(replies[0].body).toBe("Did you mean: ask reception to call Thea?");
    expect(replies[0].buttons.map((b: any) => b.title)).toEqual(["Yes", "No"]);
    expect(db.t.reception_requests).toHaveLength(0);
    await say("", "prac_cfm_no");
    expect(replies[1].body).toBe("Okay, I won't.");
    expect(db.t.reception_requests).toHaveLength(0);
  });

  it("Yes on that confirm is what sends the errand", async () => {
    process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
    const { db, say } = harness();
    await say("can reception call thea tomorrow");
    await say("yes");
    expect(db.t.reception_requests).toHaveLength(1);
    expect(String(db.t.reception_requests[0].request_text).toLowerCase()).toContain("thea");
  });

  it("a clear check-in with a clear name goes straight out", async () => {
    const { say, replies, requestCheckin } = harness();
    await say("chek in wit sam");
    expect(requestCheckin).toHaveBeenCalledWith(SAM);
    expect(replies[0].body).toContain("I've asked Sam to check in");
  });

  it("a fuzzy name or a loose check-in waits for Yes", async () => {
    const { say, replies, requestCheckin } = harness();
    await say("chek in wit sma");
    expect(requestCheckin).not.toHaveBeenCalled();
    expect(replies[0].body).toBe("Did you mean: check in with Sam Kruger?");
    await say("", "prac_cfm_no");
    expect(requestCheckin).not.toHaveBeenCalled();
    await say("sam needs a check in");
    expect(requestCheckin).not.toHaveBeenCalled();
    expect(replies[2].body).toBe("Did you mean: check in with Sam Kruger?");
    await say("", "prac_cfm_yes");
    expect(requestCheckin).toHaveBeenCalledWith(SAM);
  });

  it("how is sam doin answers; how is sma doin asks first", async () => {
    const { say, replies } = harness();
    await say("how is sam doin");
    expect(replies[0].body).toContain("*Sam Kruger*");
    await say("how is sma doin");
    expect(replies[1].body).toBe("Did you mean: how is Sam Kruger doing?");
    expect(replies[1].body).not.toContain("pain");
    await say("Yes");
    expect(replies[2].body).toContain("*Sam Kruger*");
  });

  it("hows my clints, any red flag, and whos quiet still answer", async () => {
    const { say, replies } = harness();
    await say("hows my clints");
    expect(replies[0].body).toContain("Here's how your clients are doing, Zoe");
    await say("any red flag");
    expect(replies[1].body).toContain("Open red flags");
    expect(replies[1].body).toContain("Sam Kruger");
    await say("whos quiet");
    expect(replies[2].body).toContain("Gone quiet");
    expect(replies[2].body).toContain("Lee Adams");
  });

  it("send update evry morning saves a daily update", async () => {
    const { db, say, replies } = harness();
    await say("send update evry morning");
    expect(replies[0].body).toMatch(/every day at 7:30am/);
    expect(db.t.practitioner_update_prefs[0]).toMatchObject({
      frequency: "daily",
      send_time: "07:30",
    });
  });

  it("sent sam programe tells Sam; a fuzzy name waits", async () => {
    const { say, replies, sent } = harness();
    await say("sent sam programe");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("27820000001");
    expect(replies[0].body).toBe(PRAC_MSG.willTell("Sam"));
    await say("sent sma programe");
    expect(sent).toHaveLength(1);
    expect(replies[1].body).toBe("Did you mean: tell Sam Kruger their programme is ready?");
    await say("nope");
    expect(sent).toHaveLength(1);
  });

  it("two Sams are a choice, and picking one is what sends", async () => {
    const db = world([
      {
        id: SAM2,
        full_name: "Sam Petersen",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysAgo(10),
        auth_user_id: null,
      },
    ]);
    const { say, replies, sent } = harness(db);
    await say("sent sam his program");
    expect(sent).toHaveLength(0);
    expect(replies[0].kind).toBe("list");
    expect(replies[0].body).toBe(PRAC_MSG.which);
    await say("Sam Kruger", `prog_${SAM}`);
    expect(sent).toHaveLength(1);
  });

  it("unrecognised text gets the apology, a hint, and the same buttons", async () => {
    const { say, replies } = harness();
    await say("blue elephant");
    expect(replies[0].kind).toBe("buttons");
    expect(replies[0].body).toContain("Sorry, I didn't quite get that.");
    expect(replies[0].body).toContain("how are my clients doing?");
    expect(replies[0].body).toContain("reception");
    expect(replies[0].buttons).toEqual([
      { id: "prac_status", title: "How are my clients" },
      { id: "prac_help", title: "What can you do" },
    ]);
    await say("the programme is hard");
    await say("don't check in with sam");
    await say("call thea");
    await say("quiet please");
    expect(
      replies.slice(1).every((r) => String(r.body).includes("Sorry, I didn't quite get that.")),
    ).toBe(true);
  });

  it("help mentions reception, and thanks stays short", async () => {
    const { say, replies } = harness();
    await say("what can you do");
    expect(replies[0].body).toContain("Ask reception to");
    expect(replies[0].body).toContain("What's open with reception?");
    expect(replies[0].buttons.map((b: any) => b.id)).toEqual(["prac_status", "prac_updates"]);
    await say("thx");
    expect(replies[1].body).toMatch(/Zoe\.$/);
    expect(replies[1].body).not.toContain("Here's what I can do");
    await say("ok great");
    expect(replies[2].body).toBe(PRAC_MSG.ack);
  });

  it("a pending confirm expires into the draft and comes back", () => {
    const memory: PracMemory = {
      awaitingReception: true,
      awaitingReceptionAt: NOW.getTime(),
      confirm: null,
    };
    const draft = writePracMemory({ notes: ["keep"] }, memory);
    expect(draft.notes).toEqual(["keep"]);
    expect(readPracMemory(draft, NOW.getTime()).awaitingReception).toBe(true);
    expect(readPracMemory(draft, NOW.getTime() + 31 * 60 * 1000).awaitingReception).toBe(false);
  });
});

describe("reception's own commands stay reception's", () => {
  it("done 2 and what's open are not practitioner actions", () => {
    expect(practitionerIntent("done 2", null).kind).toBe("other");
    expect(practitionerIntent("what's open", null).kind).toBe("other");
    expect(practitionerIntent("2 done", null).kind).toBe("other");
  });

  it("done 2 still closes the second open request", async () => {
    const db = fakeDb({
      profiles: [{ id: "zoe", full_name: "Zoe Test", role: "practitioner" }],
      reception_requests: [
        {
          id: "r1",
          practitioner_id: "zoe",
          request_text: "First",
          status: "open",
          created_at: daysAgo(0.2),
          sent_at: daysAgo(0.1),
          last_reply: null,
          replied_at: null,
          done_at: null,
        },
        {
          id: "r2",
          practitioner_id: "zoe",
          request_text: "Second errand",
          status: "open",
          created_at: daysAgo(0.1),
          sent_at: daysAgo(0.05),
          last_reply: null,
          replied_at: null,
          done_at: null,
        },
      ],
      whatsapp_inbound: [{ from_phone: "27600000011", received_at: daysAgo(0.01) }],
      whatsapp_outbound: [],
    });
    db.auth.admin.getUserById = async () => ({
      data: { user: { id: "zoe", phone: "27600000011" } },
    });
    const replies: any[] = [];
    await handleReceptionMessage(
      db,
      { text: "done 2", replyId: null, isMedia: false },
      {
        provider: { id: "meta", send: vi.fn(async () => ({ providerMessageId: "w" })) } as any,
        secrets: {} as any,
        now: NOW,
        phone: RECEPTION,
        reply: async (m) => void replies.push(m),
      },
    );
    expect(db.t.reception_requests[1].status).toBe("done");
    expect(db.t.reception_requests[0].status).toBe("open");
    expect(replies[0].body).toContain("Zoe");
    await handleReceptionMessage(
      db,
      { text: "what's open", replyId: null, isMedia: false },
      {
        provider: { id: "meta", send: vi.fn(async () => ({ providerMessageId: "w" })) } as any,
        secrets: {} as any,
        now: NOW,
        phone: RECEPTION,
        reply: async (m) => void replies.push(m),
      },
    );
    expect(replies[1].body).toContain("Open requests (1)");
    expect(replies[1].body).toContain("First");
    expect(replies[1].body).not.toContain("Second errand");
  });
});
