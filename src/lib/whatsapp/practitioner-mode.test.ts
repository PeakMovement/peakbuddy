import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import {
  handlePractitionerMessage,
  matchPatients,
  PRAC_MSG,
  smallTalk,
  PROGRAMME_SENT,
  practitionerByPhone,
  resetPractitionerCache,
} from "./practitioner-mode.server";

const NOW = new Date("2026-10-09T10:00:00Z");
const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";

type Row = Record<string, any>;
function fakeDb(t: Record<string, Row[]>) {
  const from = (table: string) => {
    const f: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () => (t[table] ??= []).filter((r) => f.every((x) => x(r)));
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), api),
      in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), api),
      order: () => api,
      limit: () => (patch ? api : Promise.resolve({ data: rows() })),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      update: (p: Row) => ((patch = p), api),
      insert: (r: Row) => ((t[table] ??= []).push(r), Promise.resolve({ error: null })),
      then: (res: any, rej: any) => {
        if (patch) for (const r of rows()) Object.assign(r, patch);
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return api;
  };
  return {
    from,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [{ id: "zoe", phone: "27692047284" }] } }),
      },
    },
  } as any;
}

const PRAC = { userId: "zoe", firstName: "Zoe" };

function setup(extra: Record<string, Row[]> = {}) {
  const sent: any[] = [];
  const replies: any[] = [];
  const db = fakeDb({
    practices: [{ id: "pm", practitioner_id: "justin" }],
    practice_members: [{ user_id: "zoe", practice_id: "pm", status: "active" }],
    clients: [
      {
        id: ID1,
        full_name: "Sam Kruger",
        practitioner_id: "zoe",
        practice_id: "pm",
        auth_user_id: null,
      },
      {
        id: ID2,
        full_name: "Sam Petersen",
        practitioner_id: "tristan",
        practice_id: "pm",
        auth_user_id: "u2",
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        full_name: "Lee Adams",
        practitioner_id: "zoe",
        practice_id: "pm",
        auth_user_id: null,
      },
    ],
    whatsapp_conversations: [
      {
        id: "c1",
        client_id: ID1,
        phone: "27820000001",
        opted_out_at: null,
        state: "idle",
        draft: {},
      },
    ],
    whatsapp_inbound: [{ from_phone: "+27820000001", received_at: "2026-10-09T08:00:00Z" }],
    whatsapp_outbound: [],
    ...extra,
  });
  const deps = {
    provider: {
      id: "meta",
      send: async (m: any) => (sent.push(m), { providerMessageId: "x" }),
    } as any,
    secrets: {} as any,
    now: NOW,
    reply: async (m: any) => void replies.push(m),
  };
  return { db, deps, sent, replies };
}

afterEach(() => {
  delete process.env.WHATSAPP_PROGRAMME_TEMPLATE;
  delete process.env.HEIDI_API_KEY;
  delete process.env.HEIDI_REGION;
  delete process.env.HEIDI_EHR_PROVIDER;
});

describe("practitioner mode", () => {
  it("knows a practitioner by their registered mobile", async () => {
    resetPractitionerCache();
    const db = fakeDb({
      profiles: [{ id: "zoe", full_name: "Zoe Bredenkamp", role: "practitioner" }],
    });
    expect(await practitionerByPhone(db, "27692047284")).toEqual({
      userId: "zoe",
      firstName: "Zoe",
    });
    expect(await practitionerByPhone(db, "27820000001")).toBeNull();
  });

  it("spots programme messages", () => {
    expect(PROGRAMME_SENT.test("I've sent Sam Kruger his programme")).toBe(true);
    expect(PROGRAMME_SENT.test("Lee's exercises are done")).toBe(true);
    expect(PROGRAMME_SENT.test("hello")).toBe(false);
  });

  it("matches full names over first names", () => {
    const list = [
      { id: "a", full_name: "Sam Kruger" },
      { id: "b", full_name: "Sam Petersen" },
    ];
    expect(matchPatients("sent Sam Kruger his program", list).map((p) => p.id)).toEqual(["a"]);
    expect(matchPatients("sent Sam's program", list).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("tells a patient on Buddy, inside the window", async () => {
    const { db, deps, sent, replies } = setup();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "I've sent Sam Kruger his programme", replyId: null },
      deps,
    );
    expect(sent[0]).toMatchObject({ kind: "text", to: "27820000001" });
    expect(sent[0].body).toContain("Zoe has sent you your exercise programme");
    expect(replies[0].body).toBe(PRAC_MSG.willTell("Sam"));
  });

  it("asks which Sam when two match, then acts on the choice", async () => {
    const { db, deps, sent, replies } = setup();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "sent Sam his program", replyId: null },
      deps,
    );
    expect(replies[0]).toMatchObject({ kind: "list", body: PRAC_MSG.which });
    await handlePractitionerMessage(db, PRAC, { text: "Sam Kruger", replyId: `prog_${ID1}` }, deps);
    expect(sent).toHaveLength(1);
  });

  it("says when the patient isn't registered, with the invite link", async () => {
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "sent Lee Adams her exercises", replyId: null },
      deps,
    );
    expect(replies[0].body).toBe(PRAC_MSG.notRegistered("Lee"));
    expect(replies[0].body).toContain("JOIN-PEAK");
  });

  it("app users get a push instead", async () => {
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "sent Sam Petersen his programme", replyId: null },
      deps,
    );
    expect(push).toHaveBeenCalled();
    expect(replies[0].body).toBe(PRAC_MSG.toldInApp("Sam"));
  });

  it("window shut and no template: holds it for their next message", async () => {
    const { db, deps, sent, replies } = setup({
      whatsapp_inbound: [{ from_phone: "+27820000001", received_at: "2026-10-07T08:00:00Z" }],
    });
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "sent Sam Kruger his programme", replyId: null },
      deps,
    );
    expect(sent).toHaveLength(0);
    expect(replies[0].body).toBe(PRAC_MSG.cantReachYet("Sam"));
  });

  it("window shut with the template on: sends the template", async () => {
    process.env.WHATSAPP_PROGRAMME_TEMPLATE = "buddy_programme_sent";
    const { db, deps, sent } = setup({
      whatsapp_inbound: [{ from_phone: "+27820000001", received_at: "2026-10-07T08:00:00Z" }],
    });
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "sent Sam Kruger his programme", replyId: null },
      deps,
    );
    expect(sent[0]).toMatchObject({
      kind: "template",
      templateName: "buddy_programme_sent",
      variables: ["Sam", "Zoe"],
    });
  });

  it("a greeting gets the practitioner help line", async () => {
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(db, PRAC, { text: "hi buddy", replyId: null }, deps);
    expect(replies[0].body).toBe(PRAC_MSG.help("Zoe"));
  });

  it("thanks and ok get a short reply, not the menu", async () => {
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(db, PRAC, { text: "Thank you!", replyId: null }, deps);
    await handlePractitionerMessage(db, PRAC, { text: "ok great", replyId: null }, deps);
    await handlePractitionerMessage(db, PRAC, { text: "\u{1F44D}", replyId: null }, deps);
    expect(replies[0]).toMatchObject({ kind: "text" });
    expect(replies[0].body).toMatch(/Zoe\.$/);
    expect(replies[0].body).not.toContain("Here's what I can do");
    expect(replies[2]).toMatchObject({ kind: "text", body: PRAC_MSG.ack });
  });

  it("leaves a Heidi files request alone until the Heidi secrets are set", async () => {
    delete process.env.HEIDI_API_KEY;
    delete process.env.HEIDI_REGION;
    delete process.env.HEIDI_EHR_PROVIDER;
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "get Sam Kruger's files", replyId: null },
      deps,
    );
    expect(replies[0].body).toBe(PRAC_MSG.notSure("Zoe"));
  });

  it("something unrecognised gets a short nudge with buttons", async () => {
    const { db, deps, replies } = setup();
    await handlePractitionerMessage(db, PRAC, { text: "blue elephant", replyId: null }, deps);
    expect(replies[0].kind).toBe("buttons");
    expect(replies[0].body).toBe(PRAC_MSG.notSure("Zoe"));
    await handlePractitionerMessage(db, PRAC, { text: "", replyId: "prac_help" }, deps);
    expect(replies[1].body).toBe(PRAC_MSG.help("Zoe"));
  });

  it.each([
    ["thanks", "thanks"],
    ["Thank you so much", "thanks"],
    ["cheers buddy", "thanks"],
    ["ok", "ack"],
    ["Perfect!", "ack"],
    ["Good morning", "greeting"],
    ["what can you do?", "help"],
    ["help", "help"],
    ["the knee one", null],
  ])("smallTalk(%s) = %s", (text, want) => {
    expect(smallTalk(text)).toBe(want);
  });
});
