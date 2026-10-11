import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { readPatientQuestion } from "./patient-question-text";
import { deliverWaiting, QUESTION_MSG, questionStepForPatient } from "./patient-questions.server";
import {
  classifyIntakeMessage,
  handlePractitionerReply,
  INTAKE_MSG,
  stripTaskPrefix,
} from "./practitioner-intake.server";
import { handlePractitionerMessage } from "./practitioner-mode.server";
import { practitionerIntent } from "./practitioner-status.server";

// Synthetic people and numbers only.
const NOW = new Date("2026-10-11T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const TAYLA = "aaaaaaaa-0000-4000-8000-000000000001";
const LEE = "aaaaaaaa-0000-4000-8000-000000000002";
const INTAKE = "bbbbbbbb-0000-4000-8000-000000000001";
const PRAC_PHONE = "27600000011";
const TAYLA_PHONE = "27600000021";
const PRAC = { userId: "justin", firstName: "Justin" };

type Row = Record<string, any>;
function fakeDb(t: Record<string, Row[]>) {
  const from = (table: string) => {
    const f: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () => (t[table] ??= []).filter((r) => f.every((x) => x(r)));
    const done = () => {
      const hit = rows();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit, error: null };
    };
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), api),
      in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), api),
      gte: (k: string, v: string) => (f.push((r) => r[k] >= v), api),
      order: () => api,
      limit: () => (patch ? api : Promise.resolve(done())),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      update: (p: Row) => ((patch = p), api),
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
        listUsers: async () => ({ data: { users: [{ id: "justin", phone: PRAC_PHONE }] } }),
        getUserById: async (id: string) => ({
          data: { user: id === "justin" ? { id, phone: PRAC_PHONE } : null },
        }),
      },
    },
  } as any;
}

function world(opts: { taylaWindow?: boolean } = {}) {
  const inbound: Row[] = [{ from_phone: PRAC_PHONE, received_at: hoursAgo(0.1) }];
  if (opts.taylaWindow !== false)
    inbound.push({ from_phone: TAYLA_PHONE, received_at: hoursAgo(2) });
  return fakeDb({
    profiles: [{ id: "justin", full_name: "Justin Testman", role: "super_admin" }],
    practices: [],
    practice_members: [],
    clients: [
      { id: TAYLA, full_name: "Tayla Fieldtest", practitioner_id: "justin", notes: "Old note" },
      { id: LEE, full_name: "Lee Adams", practitioner_id: "justin", notes: null },
    ],
    whatsapp_conversations: [
      { client_id: TAYLA, phone: TAYLA_PHONE, opted_out_at: null, state: "idle" },
    ],
    whatsapp_inbound: inbound,
    whatsapp_outbound: [],
    patient_questions: [],
    practitioner_intakes: [],
    alerts: [],
  });
}

function env() {
  const sent: any[] = [];
  const replies: any[] = [];
  return {
    sent,
    replies,
    provider: {
      id: "meta",
      send: vi.fn(async (m: any) => (sent.push(m), { providerMessageId: `w${sent.length}` })),
    } as any,
    secrets: {} as any,
  };
}

async function justinSays(
  db: any,
  e: ReturnType<typeof env>,
  text: string,
  replyId: string | null = null,
) {
  await handlePractitionerMessage(
    db,
    PRAC,
    { text, replyId },
    {
      provider: e.provider,
      secrets: e.secrets,
      now: NOW,
      reply: async (m: any) => void e.replies.push(m),
    },
  );
}

const JUSTINS_MESSAGE =
  "Can you message Tayla for me and ask her when her sporting events are happening and take note?";

beforeEach(() => {
  delete process.env.WHATSAPP_QUESTION_TEMPLATE;
  push.mockClear();
});
afterEach(() => {
  delete process.env.WHATSAPP_QUESTION_TEMPLATE;
});

describe("reading a question for a client", () => {
  it.each([
    [JUSTINS_MESSAGE, "When are your sporting events happening?"],
    [
      "ask Sam Kruger whether his knee swelled after the run",
      "Can you let me know if your knee swelled after the run?",
    ],
    [
      "message Lee and ask him if he has booked his scan",
      "Can you let me know if you have booked your scan?",
    ],
    ["ask Lee is he still doing his exercises", "Are you still doing your exercises?"],
    [
      "please text Ann and find out when her surgery date is",
      "Can you let me know when your surgery date is?",
    ],
  ])("%s", (text, question) => {
    expect(readPatientQuestion(text)).toBe(question);
    expect(practitionerIntent(text, null)).toEqual({ kind: "ask_patient", question });
  });

  it("leaves other commands alone", () => {
    expect(readPatientQuestion("Ask Sam to check in")).toBe(null);
    expect(practitionerIntent("Ask Sam to check in", null).kind).toBe("checkin");
    expect(readPatientQuestion("ask reception to book Sam")).toBe(null);
    expect(practitionerIntent("ask reception to book Sam", null).kind).toBe("reception");
    expect(readPatientQuestion("Ask her about her knee next session")).toBe(null);
    expect(practitionerIntent("How is Lee Adams doing?", null).kind).toBe("status_one");
  });
});

describe("asking a client", () => {
  it("asks inside the client's window and tells the practitioner", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, JUSTINS_MESSAGE);
    const q = db.t.patient_questions[0];
    expect(q).toMatchObject({ client_id: TAYLA, status: "asked" });
    expect(e.sent[0]).toMatchObject({ kind: "text", to: TAYLA_PHONE });
    expect(e.sent[0].body).toContain(
      "Hi Tayla, Justin asked me to check with you: When are your sporting events happening?",
    );
    expect(e.replies.at(-1).body).toBe(
      QUESTION_MSG.asked("Tayla", "When are your sporting events happening?"),
    );
  });

  it("uses the template outside the window, and queues without one", async () => {
    process.env.WHATSAPP_QUESTION_TEMPLATE = "buddy_patient_question";
    let db = world({ taylaWindow: false });
    let e = env();
    await justinSays(db, e, JUSTINS_MESSAGE);
    const q = db.t.patient_questions[0];
    expect(e.sent[0]).toMatchObject({
      kind: "template",
      templateName: "buddy_patient_question",
      variables: ["Tayla", "Justin"],
      buttonPayloads: [`pq_show_${q.id}`],
    });

    delete process.env.WHATSAPP_QUESTION_TEMPLATE;
    db = world({ taylaWindow: false });
    e = env();
    await justinSays(db, e, JUSTINS_MESSAGE);
    expect(e.sent).toHaveLength(0);
    expect(db.t.patient_questions[0].status).toBe("pending");
    expect(e.replies.at(-1).body).toContain("they'll get it the moment they next message Buddy");
  });

  it("confirms a name it isn't sure of, and No cancels", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "message Taylaa and ask her when her races are");
    const last = e.replies.at(-1);
    expect(last.kind).toBe("buttons");
    expect(last.body).toContain("Ask Tayla Fieldtest");
    const q = db.t.patient_questions[0];
    await justinSays(db, e, "", `pq_cancel_${q.id}`);
    expect(q.status).toBe("cancelled");
    expect(e.sent).toHaveLength(0);
    await justinSays(db, e, "", `pq_pick_${q.id}_${TAYLA}`);
    expect(e.sent).toHaveLength(0);
  });
});

describe("the client's answer", () => {
  function asked(db: any) {
    db.t.patient_questions.push({
      id: "cccccccc-0000-4000-8000-000000000001",
      client_id: TAYLA,
      practitioner_id: "justin",
      question: "When are your sporting events happening?",
      status: "asked",
      created_at: hoursAgo(3),
      asked_at: hoursAgo(3),
    });
  }
  const tayla = { id: TAYLA, full_name: "Tayla Fieldtest" };

  it("saves the answer to notes, tells the practitioner and thanks the client", async () => {
    const db = world();
    const e = env();
    asked(db);
    const step = await questionStepForPatient(db, e, {
      client: tayla,
      text: "Saturday the 18th and 2 November",
      replyId: null,
      idle: true,
      now: NOW,
    });
    expect(step?.replies[0].body).toBe(QUESTION_MSG.thanks("Justin"));
    expect(db.t.patient_questions[0]).toMatchObject({
      status: "answered",
      answer: "Saturday the 18th and 2 November",
    });
    const notes = db.t.clients.find((c: Row) => c.id === TAYLA).notes;
    expect(notes).toContain("Old note");
    expect(notes).toContain('Justin asked "When are your sporting events happening?"');
    expect(notes).toContain("Saturday the 18th and 2 November");
    expect(e.sent[0]).toMatchObject({ kind: "text", to: PRAC_PHONE });
    expect(e.sent[0].body).toContain("Tayla F. answered your question");
    expect(db.t.alerts[0]).toMatchObject({
      client_id: TAYLA,
      alert_type: "client_contact_request",
    });
  });

  it("is not taken mid check-in, from a button, or from a hello", async () => {
    const db = world();
    const e = env();
    asked(db);
    const base = { client: tayla, replyId: null, idle: true, now: NOW };
    expect(await questionStepForPatient(db, e, { ...base, text: "7", idle: false })).toBe(null);
    expect(
      await questionStepForPatient(db, e, { ...base, text: "Start", replyId: "start_checkin" }),
    ).toBe(null);
    expect(await questionStepForPatient(db, e, { ...base, text: "Morning!" })).toBe(null);
    expect(db.t.patient_questions[0].status).toBe("asked");
  });

  it("See question shows it; a waiting question goes out once idle", async () => {
    const db = world();
    const e = env();
    db.t.patient_questions.push({
      id: "cccccccc-0000-4000-8000-000000000002",
      client_id: TAYLA,
      practitioner_id: "justin",
      question: "When are your sporting events happening?",
      status: "pending",
      created_at: hoursAgo(30),
      asked_at: null,
    });
    const step = await questionStepForPatient(db, e, {
      client: tayla,
      text: "See question",
      replyId: "pq_show_cccccccc-0000-4000-8000-000000000002",
      idle: true,
      now: NOW,
    });
    expect(step?.replies[0].body).toContain("Justin asked me to check with you");
    expect(db.t.patient_questions[0].status).toBe("asked");

    db.t.patient_questions[0].status = "pending";
    expect(await deliverWaiting(db, { client: tayla, idleAfter: false, now: NOW })).toEqual([]);
    const extra = await deliverWaiting(db, { client: tayla, idleAfter: true, now: NOW });
    expect(extra[0].body).toContain("When are your sporting events happening?");
    expect(db.t.patient_questions[0].status).toBe("asked");
  });
});

describe("notes or instructions while Buddy is taking notes", () => {
  it.each([
    [JUSTINS_MESSAGE, "task"],
    ["note: ACL repair 3 Sept", "note"],
    ["Please note she is anxious about racing", "note"],
    ["ACL recon 2 Oct, no running until week 12", "note"],
    ["Training for the Two Oceans half, races most weekends", "note"],
    ["Ask her about her knee next session", "note"],
    ["task ask reception to book Sam", "task"],
    ["ask the secretary to call Tayla", "task"],
    ["How is Lee Adams doing?", "task"],
    ["Is the swelling normal at this stage?", "unclear"],
  ])("%s -> %s", async (text, kind) => {
    expect(await classifyIntakeMessage(text)).toBe(kind);
  });

  it("strips the task keyword", () => {
    expect(stripTaskPrefix("task: ask reception to book Sam")).toBe("ask reception to book Sam");
    expect(stripTaskPrefix("ask reception")).toBe("ask reception");
  });

  function collecting() {
    const db = world();
    db.t.practitioner_intakes.push({
      id: INTAKE,
      client_id: TAYLA,
      phone: PRAC_PHONE,
      status: "collecting",
      created_at: hoursAgo(1),
      opened_at: hoursAgo(0.1),
      last_message_at: hoursAgo(0.05),
    });
    const sent: string[] = [];
    const buttons: Array<{ body: string; buttons: Array<{ id: string }> }> = [];
    const deps = {
      now: NOW,
      transcribe: async () => null,
      send: async (b: string) => void sent.push(b),
      sendButtons: async (body: string, list: Array<{ id: string; title: string }>) =>
        void buttons.push({ body, buttons: list }),
    };
    const say = (text: string, replyId: string | null = null) =>
      handlePractitionerReply(db, { phone: PRAC_PHONE, text, replyId, isAudio: false }, deps);
    return { db, sent, buttons, say };
  }

  it("an instruction closes note taking and goes on as a command", async () => {
    const { db, sent, say } = collecting();
    const out = await say(JUSTINS_MESSAGE);
    expect(out).toEqual({ reroute: JUSTINS_MESSAGE });
    expect(db.t.practitioner_intakes[0].status).toBe("done");
    expect(sent[0]).toBe(INTAKE_MSG.closedForTask("Tayla F."));
    expect(db.t.clients.find((c: Row) => c.id === TAYLA).notes).toBe("Old note");
  });

  it("notes are saved with a Done button; Done closes", async () => {
    const { db, buttons, sent, say } = collecting();
    expect(await say("note: ACL repair 3 Sept, racing again in December")).toBe(true);
    expect(db.t.clients.find((c: Row) => c.id === TAYLA).notes).toContain(
      "ACL repair 3 Sept, racing again in December",
    );
    expect(db.t.clients.find((c: Row) => c.id === TAYLA).notes).not.toContain("note:");
    expect(buttons[0].buttons[0].id).toBe(`intake_done:${INTAKE}`);
    await say("Done", `intake_done:${INTAKE}`);
    expect(db.t.practitioner_intakes[0].status).toBe("done");
    expect(sent.at(-1)).toContain("never share your notes");
  });

  it("when unsure it asks, then does what was tapped", async () => {
    const { db, buttons, say } = collecting();
    expect(await say("Is the swelling normal at this stage?")).toBe(true);
    expect(buttons[0].buttons.map((b) => b.id)).toEqual([
      `intake_note:${INTAKE}`,
      `intake_task:${INTAKE}`,
    ]);
    expect(await say("Save as note", `intake_note:${INTAKE}`)).toBe(true);
    expect(db.t.clients.find((c: Row) => c.id === TAYLA).notes).toContain(
      "Is the swelling normal at this stage?",
    );

    await say("Should she ice it?");
    expect(await say("Do it", `intake_task:${INTAKE}`)).toEqual({ reroute: "Should she ice it?" });
    expect(db.t.practitioner_intakes[0].status).toBe("done");
  });

  it("note taking closes after 20 quiet minutes", async () => {
    const { db, say } = collecting();
    db.t.practitioner_intakes[0].last_message_at = hoursAgo(0.5);
    expect(await say("ACL repair 3 Sept")).toBe(false);
    expect(db.t.practitioner_intakes[0].status).toBe("done");
  });
});
