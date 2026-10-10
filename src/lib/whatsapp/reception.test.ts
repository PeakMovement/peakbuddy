import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { handlePractitionerMessage } from "./practitioner-mode.server";
import { practitionerIntent, readReceptionTask } from "./practitioner-status.server";
import {
  handleReceptionMessage,
  isReceptionPhone,
  practitionerOpenList,
  RECEPTION_MSG,
} from "./reception.server";

// Synthetic numbers and people only.
const NOW = new Date("2026-10-10T08:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const RECEPTION = "27600000099";
const ZOE_PHONE = "27600000011";
const PRAC = { userId: "zoe", firstName: "Zoe" };

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
        listUsers: async () => ({ data: { users: [{ id: "zoe", phone: ZOE_PHONE }] } }),
        getUserById: async (id: string) => ({
          data: { user: id === "zoe" ? { id, phone: ZOE_PHONE } : null },
        }),
      },
    },
  } as any;
}

function world(opts: { receptionWindow?: boolean; zoeWindow?: boolean } = {}) {
  const inbound: Row[] = [];
  if (opts.receptionWindow !== false)
    inbound.push({ from_phone: RECEPTION, received_at: hoursAgo(2) });
  if (opts.zoeWindow !== false) inbound.push({ from_phone: ZOE_PHONE, received_at: hoursAgo(1) });
  return fakeDb({
    profiles: [{ id: "zoe", full_name: "Zoe Testperson", role: "practitioner" }],
    practices: [],
    practice_members: [],
    clients: [],
    reception_requests: [],
    whatsapp_inbound: inbound,
    whatsapp_outbound: [],
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

async function practitionerSays(db: any, e: ReturnType<typeof env>, text: string) {
  await handlePractitionerMessage(
    db,
    PRAC,
    { text, replyId: null },
    {
      provider: e.provider,
      secrets: e.secrets,
      now: NOW,
      reply: async (m: any) => void e.replies.push(m),
    },
  );
}

async function receptionSays(
  db: any,
  e: ReturnType<typeof env>,
  text: string,
  replyId: string | null = null,
) {
  await handleReceptionMessage(
    db,
    { text, replyId, isMedia: false },
    {
      provider: e.provider,
      secrets: e.secrets,
      now: NOW,
      phone: RECEPTION,
      reply: async (m) => void e.replies.push(m),
    },
  );
}

beforeEach(() => {
  process.env.WHATSAPP_RECEPTION_NUMBER = `+${RECEPTION}`;
  delete process.env.WHATSAPP_RECEPTION_TEMPLATE;
  push.mockClear();
});
afterEach(() => {
  delete process.env.WHATSAPP_RECEPTION_NUMBER;
  delete process.env.WHATSAPP_RECEPTION_TEMPLATE;
});

describe("reception intents", () => {
  it.each([
    [
      "Ask reception to book Sam Kruger for Thursday afternoon",
      "Book Sam Kruger for Thursday afternoon",
    ],
    ["please ask the receptionist to send Lee an invoice.", "Send Lee an invoice"],
    ["Tell the front desk that Ann needs a call back", "Ann needs a call back"],
    ["Reception: call Ann back about Friday", "Call Ann back about Friday"],
    ["can you ask reception to remind Sam to check in", "Remind Sam to check in"],
  ])("%s", (text, task) => {
    expect(readReceptionTask(text)).toBe(task);
    expect(practitionerIntent(text, null)).toEqual({ kind: "reception", task });
  });

  it("other commands are untouched", () => {
    expect(practitionerIntent("what's open with reception?", null).kind).toBe("reception_open");
    expect(practitionerIntent("Ask Sam to check in", null).kind).toBe("checkin");
    expect(practitionerIntent("How are my clients doing?", null).kind).toBe("status_all");
    expect(readReceptionTask("reception")).toBe(null);
  });

  it("recognises the reception number however it's written", () => {
    expect(isReceptionPhone(RECEPTION)).toBe(true);
    expect(isReceptionPhone(`+${RECEPTION}`)).toBe(true);
    expect(isReceptionPhone(ZOE_PHONE)).toBe(false);
  });
});

describe("reception errands", () => {
  it("forwards inside reception's window with a Done button", async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday afternoon");
    const req = db.t.reception_requests[0];
    expect(req).toMatchObject({
      practitioner_id: "zoe",
      status: "open",
      sent_at: NOW.toISOString(),
    });
    expect(e.sent[0]).toMatchObject({ kind: "buttons", to: RECEPTION });
    expect(e.sent[0].body).toContain("New request from Zoe:");
    expect(e.sent[0].body).toContain("Book Sam Kruger for Thursday afternoon");
    expect(e.sent[0].buttons).toEqual([{ id: `rcp_done_${req.id}`, title: "Done" }]);
    expect(e.replies[0].body).toBe(RECEPTION_MSG.toPractitioner("sent"));
  });

  it("uses the template outside the window", async () => {
    process.env.WHATSAPP_RECEPTION_TEMPLATE = "buddy_reception_request";
    const db = world({ receptionWindow: false });
    const e = env();
    await practitionerSays(db, e, "ask reception to send Lee an invoice");
    const req = db.t.reception_requests[0];
    expect(e.sent[0]).toMatchObject({
      kind: "template",
      to: RECEPTION,
      templateName: "buddy_reception_request",
      variables: ["Zoe", "Send Lee an invoice"],
      buttonPayloads: [`rcp_done_${req.id}`],
    });
    expect(e.replies[0].body).toBe(RECEPTION_MSG.toPractitioner("sent"));
  });

  it("waits without a template, then delivers when reception says hi", async () => {
    const db = world({ receptionWindow: false });
    const e = env();
    await practitionerSays(db, e, "ask reception to send Lee an invoice");
    expect(e.sent).toHaveLength(0);
    expect(e.replies[0].body).toBe(RECEPTION_MSG.toPractitioner("waiting"));
    expect(db.t.reception_requests[0].sent_at).toBe(null);

    e.replies.length = 0;
    await receptionSays(db, e, "Morning Buddy");
    expect(e.sent[0]).toMatchObject({ kind: "buttons", to: RECEPTION });
    expect(db.t.reception_requests[0].sent_at).toBe(NOW.toISOString());
    expect(e.replies[0].body).toContain("Morning! Open requests (1):");
    expect(e.replies[0].body).toContain("1. From Zoe");
  });

  it("relays a typed reply to the practitioner who asked", async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday afternoon");
    e.sent.length = 0;
    e.replies.length = 0;
    await receptionSays(db, e, "He can only do Friday at 10");
    expect(e.sent[0]).toMatchObject({ kind: "text", to: ZOE_PHONE });
    expect(e.sent[0].body).toContain(
      'Reception replied about "Book Sam Kruger for Thursday afternoon"',
    );
    expect(e.sent[0].body).toContain("He can only do Friday at 10");
    expect(e.replies[0].body).toBe("Passed to Zoe.");
    expect(db.t.reception_requests[0].last_reply).toBe("He can only do Friday at 10");
    expect(db.t.reception_requests[0].status).toBe("open");
  });

  it("falls back to a push when the practitioner's window is closed", async () => {
    const db = world({ zoeWindow: false });
    const e = env();
    db.t.reception_requests.push({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      practitioner_id: "zoe",
      request_text: "Send Lee an invoice",
      status: "open",
      created_at: hoursAgo(30),
      sent_at: hoursAgo(30),
    });
    await receptionSays(db, e, "Sent this morning");
    expect(e.sent.filter((m) => m.to === ZOE_PHONE)).toHaveLength(0);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("Done button closes the right request and tells the practitioner", async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday");
    await practitionerSays(db, e, "Ask reception to send Lee an invoice");
    const first = db.t.reception_requests[0];
    e.sent.length = 0;
    e.replies.length = 0;
    await receptionSays(db, e, "Done", `rcp_done_${first.id}`);
    expect(first.status).toBe("done");
    expect(db.t.reception_requests[1].status).toBe("open");
    expect(e.sent[0].body).toContain('Reception has done it: "Book Sam Kruger for Thursday"');
    expect(e.replies[0].body).toBe(RECEPTION_MSG.doneThanks("Zoe"));
    await receptionSays(db, e, "Done", `rcp_done_${first.id}`);
    expect(e.replies[1].body).toBe(RECEPTION_MSG.alreadyDone);
  });

  it('"done" closes the only open request; with several it asks which', async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday");
    await practitionerSays(db, e, "Ask reception to send Lee an invoice");
    e.replies.length = 0;
    await receptionSays(db, e, "done");
    expect(e.replies[0].body).toContain(RECEPTION_MSG.whichDone);
    await receptionSays(db, e, "done 2");
    expect(db.t.reception_requests[1].status).toBe("done");
    await receptionSays(db, e, "Done!");
    expect(db.t.reception_requests[0].status).toBe("done");
  });

  it("ok and thanks from reception aren't relayed", async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday");
    e.sent.length = 0;
    e.replies.length = 0;
    await receptionSays(db, e, "ok");
    await receptionSays(db, e, "Thanks!");
    expect(e.sent).toHaveLength(0);
    expect(e.replies.map((r) => r.body)).toEqual([RECEPTION_MSG.ack, RECEPTION_MSG.ack]);
  });

  it("a reply with nothing open isn't passed on", async () => {
    const db = world();
    const e = env();
    await receptionSays(db, e, "Can someone call me back");
    expect(e.sent).toHaveLength(0);
    expect(e.replies[0].body).toBe(RECEPTION_MSG.nothingOpen);
  });

  it("no reception number set", async () => {
    delete process.env.WHATSAPP_RECEPTION_NUMBER;
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday");
    expect(e.replies[0].body).toBe(RECEPTION_MSG.toPractitioner("no_number"));
  });

  it("practitioner can see what's open", async () => {
    const db = world();
    const e = env();
    await practitionerSays(db, e, "Ask reception to book Sam Kruger for Thursday");
    await receptionSays(db, e, "Friday only");
    const body = await practitionerOpenList(db, "zoe", NOW);
    expect(body).toContain("Open with reception (1):");
    expect(body).toContain('"Friday only"');
    e.replies.length = 0;
    await practitionerSays(db, e, "what's still open with reception?");
    expect(e.replies[0].body).toContain("Open with reception (1):");
  });
});
