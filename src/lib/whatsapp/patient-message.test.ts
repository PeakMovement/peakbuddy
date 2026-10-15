import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { readPatientMessage } from "./patient-message-text";
import { questionStepForPatient } from "./patient-questions.server";
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

let mem: any = {};
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
    mem,
  );
}

const last = (e: ReturnType<typeof env>) => e.replies[e.replies.length - 1];
const draftOf = (db: any) => db.t.patient_questions[db.t.patient_questions.length - 1];

beforeEach(() => {
  mem = {};
  delete process.env.WHATSAPP_MESSAGE_TEMPLATE;
  push.mockClear();
});

describe("reading a message to pass on", () => {
  it.each([
    ["Can you tell her i love her?", "her", true],
    ["tell Tayla well done on her race", null, false],
    ["let Tayla know that her appointment moved to 3pm", "Tayla", false],
    ["message Lee saying see you Thursday", "Lee", false],
    ["say good luck to Tayla", "Tayla", false],
  ])("%s", (text, who, pronoun) => {
    const r = readPatientMessage(text);
    expect(r).not.toBeNull();
    expect(r!.who).toBe(who);
    expect(r!.pronoun).toBe(pronoun);
  });

  it.each([
    "Please let Tayla know how Chris is",
    "tell Tayla to check in",
    "tell me how Tayla is doing",
    "tell reception to call Lee",
    "tell Tayla her programme is ready",
    "ask Tayla when her race is",
  ])("not a message: %s", (text) => {
    expect(readPatientMessage(text)).toBeNull();
  });

  it("intent", () => {
    expect(practitionerIntent("Can you tell her i love her?", null).kind).toBe("message_patient");
    expect(practitionerIntent("", `pm_reply_${TAYLA}`).kind).toBe("message_reply");
    expect(practitionerIntent("ask Tayla when her race is", null).kind).toBe("ask_patient");
  });
});

describe("Justin's chat from 12 Oct, replayed", () => {
  it("ask, answer comes back with a Reply button, then 'tell her I love her'", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "Please ask tayla how she is doing");
    expect(last(e).body).toContain("Done, I've asked Tayla");

    // Tayla answers; Justin gets it with Reply and Client details buttons.
    await questionStepForPatient(db, e as any, {
      client: { id: TAYLA, full_name: "Tayla Fieldtest" },
      text: "Feeling good, hamstrings a bit tight",
      replyId: null,
      idle: true,
      now: NOW,
    });
    const relay = e.sent[e.sent.length - 1];
    expect(relay.kind).toBe("buttons");
    expect(relay.buttons.map((b: any) => b.id)).toEqual([`pm_reply_${TAYLA}`, `prac_one_${TAYLA}`]);

    await justinSays(db, e, "Can you tell her i love her?");
    expect(last(e).kind).toBe("buttons");
    expect(last(e).body).toBe('Send to Tayla Fieldtest:\n\n"I love you"');
    const draft = draftOf(db);
    expect(draft.status).toBe("draft");
    expect(last(e).buttons[0]).toEqual({ id: `pq_pick_${draft.id}_${TAYLA}`, title: "Send" });

    await justinSays(db, e, "", `pq_pick_${draft.id}_${TAYLA}`);
    expect(last(e).body).toBe(`Sent to Tayla: "I love you" I'll send you their reply.`);
    expect(e.sent[e.sent.length - 1].body).toBe(
      `Hi Tayla, a message from Justin:\n\n"I love you"\n\nYou can reply here and I'll pass it on.`,
    );

    // Her reply comes back as a reply, not an answer.
    await questionStepForPatient(db, e as any, {
      client: { id: TAYLA, full_name: "Tayla Fieldtest" },
      text: "Haha thanks!",
      replyId: null,
      idle: true,
      now: NOW,
    });
    expect(e.sent[e.sent.length - 1].body).toBe(
      'Tayla F. replied to your message "I love you":\n\nHaha thanks!',
    );
  });

  it("Reply button: the next message goes as typed, no confirm", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "", `pm_reply_${TAYLA}`);
    expect(last(e).body).toBe(
      "What would you like to say to Tayla? Type it and I'll send it as it is.",
    );
    await justinSays(db, e, "Great to hear, keep stretching");
    expect(last(e).body).toBe(
      `Sent to Tayla: "Great to hear, keep stretching" I'll send you their reply.`,
    );
    expect(e.sent[e.sent.length - 1].to).toBe(TAYLA_PHONE);
  });

  it("a named message swaps her/his for you and asks first", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "tell Tayla well done on her race");
    expect(last(e).body).toBe('Send to Tayla Fieldtest:\n\n"Well done on your race"');
    await justinSays(db, e, "", last(e).buttons[1].id);
    expect(last(e).body).toBe("No problem, I haven't sent anything.");
    expect(draftOf(db).status).toBe("cancelled");
  });

  it("outside the client's window without a message template, it waits", async () => {
    const db = world({ taylaWindow: false });
    const e = env();
    await justinSays(db, e, "message Tayla saying see you Thursday");
    await justinSays(db, e, "", last(e).buttons[0].id);
    expect(last(e).body).toContain("hasn't messaged me in the last day");
    process.env.WHATSAPP_QUESTION_TEMPLATE = "buddy_patient_question";
    await justinSays(db, e, "message Tayla saying see you Friday");
    await justinSays(db, e, "", last(e).buttons[0].id);
    // The question template says "a quick question", so a message never uses it.
    expect(e.sent.some((m: any) => m.kind === "template")).toBe(false);
    delete process.env.WHATSAPP_QUESTION_TEMPLATE;
  });

  it("with the message template, it opens the window", async () => {
    process.env.WHATSAPP_MESSAGE_TEMPLATE = "buddy_patient_message";
    const db = world({ taylaWindow: false });
    const e = env();
    await justinSays(db, e, "message Tayla saying see you Thursday");
    await justinSays(db, e, "", last(e).buttons[0].id);
    const t = e.sent[e.sent.length - 1];
    expect(t).toMatchObject({ kind: "template", templateName: "buddy_patient_message" });
    expect(t.variables).toEqual(["Tayla", "Justin"]);
  });

  it("'her' with nobody in context asks who", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "tell her I love her");
    expect(last(e).body).toContain('not sure who "her" is');
  });

  it("an unrecognised line soon after a client replied offers to pass it on", async () => {
    const db = world();
    const e = env();
    await justinSays(db, e, "Please ask tayla how she is doing");
    await questionStepForPatient(db, e as any, {
      client: { id: TAYLA, full_name: "Tayla Fieldtest" },
      text: "Feeling good",
      replyId: null,
      idle: true,
      now: NOW,
    });
    mem = {};
    await justinSays(db, e, "Glad to hear it, see you next week");
    expect(last(e).body).toBe('Send to Tayla Fieldtest:\n\n"Glad to hear it, see you next week"');
  });
});
