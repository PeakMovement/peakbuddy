/**
 * Practitioner agent (11 Oct 2026). Justin's real chat, plus the follow-ups
 * the phrase matcher dropped: several people, a wording of his own, "all 4",
 * "the first one", "and Steven too". The model is a mock. It only chooses a
 * tool. Names and statuses in the reply have to come from the fixture.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { HEIDI_MSG } from "./heidi";
import { decidePractitionerTurn } from "./ai.server";
import {
  addedNames,
  checkinPreview,
  decisionFromGateway,
  decisionsFromGateway,
  expandReferences,
  extraCheckinNote,
  isExactShortcut,
  joinNames,
  needsPractitionerAgent,
  resolveChoice,
  resolveNames,
  validDecision,
  type AgentDecision,
  type AgentTurnInput,
} from "./practitioner-agent";
import {
  handlePractitionerMessage,
  PRAC_MSG,
  type PractitionerDeps,
} from "./practitioner-mode.server";
import {
  readPracMemory,
  writePracMemory,
  type PracCandidate,
  type PracMemory,
} from "./practitioner-understand";
import type { OutboundMessage, WhatsAppProvider } from "./provider";
import { practitionerCheckinText } from "./voice";

type AdminClient = Parameters<typeof handlePractitionerMessage>[0];
type Reply = { body: string; buttons?: Array<{ id: string; title: string }> };

const replyText = (replies: Reply[]) => replies.at(-1)?.body ?? "";
const textSent = (sent: OutboundMessage[]) => {
  const message = sent.find((m) => m.kind === "text");
  return message?.kind === "text" ? message.body : "";
};

const NOW = new Date("2026-10-11T12:00:00.000Z");
const CAYLA = "11111111-1111-4111-8111-111111111111";
const MICHAELA = "22222222-2222-4222-8222-222222222222";
const STEVEN = "33333333-3333-4333-8333-333333333333";
const STEVEN2 = "44444444-4444-4444-8444-444444444444";
const VICKI = "55555555-5555-4555-8555-555555555555";
const LAUREN = "66666666-6666-4666-8666-666666666666";

const JUSTIN = { userId: "justin", firstName: "Justin" };
const ZOE = { userId: "zoe", firstName: "Zoe" };

const FOUR =
  "Please contact cayla, michaela, steven and vicki and ask them how they are doing, make sure to say you are with Peak Movement";

type Row = Record<string, unknown>;

interface FakeQuery extends PromiseLike<{ data: Row[]; error: null }> {
  select: () => FakeQuery;
  eq: (k: string, v: unknown) => FakeQuery;
  in: (k: string, v: unknown[]) => FakeQuery;
  gte: (k: string, v: unknown) => FakeQuery;
  lt: (k: string, v: unknown) => FakeQuery;
  is: (k: string, v: unknown) => FakeQuery;
  order: () => FakeQuery;
  limit: () => FakeQuery;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  update: (p: Row) => FakeQuery;
  insert: (r: Row | Row[]) => Promise<{ data: Row[]; error: null }>;
  upsert: (r: Row) => Promise<{ data: Row; error: null }>;
}

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string): FakeQuery => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const api: FakeQuery = {
      select: () => api,
      eq: (k, v) => (filters.push((r) => r[k] === v), api),
      in: (k, v) => (filters.push((r) => v.some((item) => item === r[k])), api),
      gte: (k, v) => (filters.push((r) => String(r[k] ?? "") >= String(v)), api),
      lt: (k, v) => (filters.push((r) => String(r[k] ?? "") < String(v)), api),
      is: (k, v) => (filters.push((r) => r[k] === v), api),
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      update: (p) => ((patch = p), api),
      insert: (r) => {
        const list = Array.isArray(r) ? r : [r];
        for (const row of list) (tables[table] ??= []).push(row);
        return Promise.resolve({ data: list, error: null });
      },
      upsert: (r) => {
        (tables[table] ??= []).push(r);
        return Promise.resolve({ data: r, error: null });
      },
      then: (res, rej) => {
        if (patch) for (const r of rows()) Object.assign(r, patch);
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return api;
  };
  return {
    from,
    t: tables,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "" } } }),
        listUsers: async () => ({ data: { users: [] } }),
      },
    },
  };
}

const asAdmin = (db: ReturnType<typeof fakeDb>) => db as unknown as AdminClient;

function baseTables(extraStevens = false): Record<string, Row[]> {
  return {
    practices: [{ id: "pm", practitioner_id: "justin", practice_name: "Peak Movement" }],
    practice_members: [
      { user_id: "zoe", practice_id: "pm", status: "active", role: "practitioner" },
      { user_id: "tristan", practice_id: "pm", status: "active", role: "practitioner" },
    ],
    profiles: [
      { id: "justin", full_name: "Justin Owner", role: "super_admin" },
      { id: "zoe", full_name: "Zoe Naude", role: "practitioner" },
      { id: "tristan", full_name: "Tristan Botha", role: "practitioner" },
    ],
    clients: [
      {
        id: CAYLA,
        full_name: "Cayla Rosenblatt",
        practitioner_id: "zoe",
        practice_id: "pm",
        auth_user_id: null,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: MICHAELA,
        full_name: "Michaela Geldhof",
        practitioner_id: "tristan",
        practice_id: "pm",
        auth_user_id: null,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: STEVEN,
        full_name: "Steven Jacobs",
        practitioner_id: "justin",
        practice_id: "pm",
        auth_user_id: "user-steven",
        created_at: "2026-09-01T00:00:00Z",
      },
      ...(extraStevens
        ? [
            {
              id: STEVEN2,
              full_name: "Steven Adams",
              practitioner_id: "justin",
              practice_id: "pm",
              auth_user_id: null,
              created_at: "2026-09-01T00:00:00Z",
            },
          ]
        : []),
      {
        id: VICKI,
        full_name: "Vicki-Leigh Atkinson",
        practitioner_id: "justin",
        practice_id: "pm",
        auth_user_id: null,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: LAUREN,
        full_name: "Lauren Ogg",
        practitioner_id: "justin",
        practice_id: "pm",
        auth_user_id: null,
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    whatsapp_conversations: [
      { id: "c-cayla", client_id: CAYLA, phone: "27821111111", opted_out_at: null, state: "idle" },
      {
        id: "c-mich",
        client_id: MICHAELA,
        phone: "27822222222",
        opted_out_at: null,
        state: "idle",
      },
    ],
    whatsapp_inbound: [
      { from_phone: "+27821111111", received_at: "2026-10-11T10:00:00Z" },
      { from_phone: "+27822222222", received_at: "2026-10-08T10:00:00Z" },
    ],
    whatsapp_outbound: [],
    check_ins: [
      {
        client_id: CAYLA,
        pain_level: 4,
        sleep_quality: 3,
        energy_level: 3,
        notes: "knee felt easier",
        created_at: "2026-10-11T08:00:00Z",
      },
      {
        client_id: STEVEN,
        pain_level: 2,
        sleep_quality: 4,
        energy_level: 4,
        notes: null,
        created_at: "2026-10-11T08:00:00Z",
      },
      {
        client_id: MICHAELA,
        pain_level: 3,
        sleep_quality: 3,
        energy_level: 3,
        notes: null,
        created_at: "2026-10-05T08:00:00Z",
      },
    ],
    alerts: [
      {
        id: "alert-lauren",
        client_id: LAUREN,
        alert_type: "client_contact_request",
        urgency: "soon",
        created_at: "2026-10-11T09:00:00Z",
        is_read: false,
        reviewed_at: null,
        message: "Lauren says the knee felt easier today.",
      },
    ],
    practitioner_checkin_requests: [],
    practitioner_update_prefs: [],
    reception_requests: [],
  };
}

function harness(
  opts: { understand?: (input: AgentTurnInput) => Promise<unknown>; extraStevens?: boolean } = {},
) {
  const sent: OutboundMessage[] = [];
  const replies: Reply[] = [];
  const db = fakeDb(baseTables(opts.extraStevens));
  const provider: WhatsAppProvider = {
    id: "meta",
    verifySignature: async () => true,
    parseWebhook: () => ({ messages: [], statuses: [] }),
    send: async (message) => {
      sent.push(message);
      return { providerMessageId: `m${sent.length}` };
    },
  };
  const deps: PractitionerDeps = {
    provider,
    secrets: { signingSecret: "test", senderId: "1" },
    now: NOW,
    understand: opts.understand,
    reply: async (message) => {
      if ("body" in message) replies.push(message);
    },
  };
  return { db, deps, sent, replies };
}

const CHECKIN_FOUR: AgentDecision = {
  tool: "send_checkin",
  names: ["cayla", "michaela", "steven", "vicki"],
  note: "say you are with Peak Movement",
  task: null,
  question: null,
  options: [],
  frequency: null,
  weekday: null,
  time: null,
  enabled: null,
};

const PREVIEW = `Hi <name>, it's Buddy from Peak Movement, checking in on how you're doing.`;

afterEach(() => {
  push.mockClear();
  delete process.env.WHATSAPP_REMINDER_TEMPLATE;
  delete process.env.WHATSAPP_RECEPTION_NUMBER;
  delete process.env.HEIDI_API_KEY;
  delete process.env.HEIDI_REGION;
  delete process.env.HEIDI_EHR_PROVIDER;
});

describe("what reaches the model", () => {
  const messy = [
    "cayla?",
    "msg the quiet ones",
    "lauren wat she say",
    "ye do it",
    "all",
    "👍",
    "hoe gaan dit met cayla",
    "please tell me all the practitioners you have listed",
    FOUR,
    "what was laurens message",
    "I've sent Cayla Rosenblatt her programme",
    "hi buddy",
    "thanks",
    "update me every morning",
    "um can you just check in with cayla and also tell me who's gone quiet",
  ];
  it.each(messy)("reads %s with the model", (text) => {
    expect(isExactShortcut(text, null)).toBe(false);
    expect(needsPractitionerAgent(text)).toBe(true);
  });

  const exact = [
    "how are my clients doing?",
    "my messages",
    "any red flags?",
    "who's gone quiet?",
    "how many clients are using Buddy?",
    "practice overview",
    "help",
    "what can you do?",
  ];
  it.each(exact)("skips the model for the exact command %s", (text) => {
    expect(isExactShortcut(text, null)).toBe(true);
    expect(needsPractitionerAgent(text)).toBe(false);
  });

  it("a button tap skips the model, and a bare pain score stays with the patient check-in", () => {
    expect(isExactShortcut("", "prac_status")).toBe(true);
    expect(isExactShortcut("yes", "prac_ag_yes")).toBe(false);
    expect(needsPractitionerAgent("6")).toBe(false);
    expect(needsPractitionerAgent("all", { pending: { kind: "choose" } as never })).toBe(true);
  });
});

describe("reading a model tool call", () => {
  it("accepts an OpenAI tool call, a JSON reply, and Gemini's functionCall", () => {
    expect(
      decisionFromGateway({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "list_practitioners",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      })?.tool,
    ).toBe("list_practitioners");
    expect(
      decisionFromGateway({ choices: [{ message: { content: '{"tool":"usage"}' } }] })?.tool,
    ).toBe("usage");
    expect(
      decisionFromGateway({
        candidates: [
          { content: { parts: [{ functionCall: { name: "quiet_clients", args: {} } }] } },
        ],
      })?.tool,
    ).toBe("quiet_clients");
    expect(
      decisionFromGateway({ choices: [{ message: { content: "Cayla is doing well, pain 2" } }] }),
    ).toBe(null);
    expect(validDecision({ tool: "invent_client", names: ["Beyonce"] })).toBeNull();
    expect(
      decisionsFromGateway({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: "client_status", arguments: '{"names":["cayla"]}' } },
                {
                  function: {
                    name: "send_checkin",
                    arguments: '{"names":["steven"],"note":"the race is Saturday"}',
                  },
                },
              ],
            },
          },
        ],
      }).map((d) => d.tool),
    ).toEqual(["client_status", "send_checkin"]);
  });

  it("drops a note that only repeats the practice, and keeps a real one", () => {
    expect(extraCheckinNote("say you are with Peak Movement", "Peak Movement")).toBeNull();
    expect(extraCheckinNote("mention that the race is on Saturday", "Peak Movement")).toBe(
      "The race is on Saturday",
    );
    expect(checkinPreview("Peak Movement", "make sure to say you are with Peak Movement")).toBe(
      PREVIEW,
    );
    expect(practitionerCheckinText("Cayla", "Peak Movement", null)).toBe(
      "Hi Cayla, it's Buddy from Peak Movement, checking in on how you're doing.",
    );
  });

  it("resolves all, numbers, ordinals and names", () => {
    const candidates: PracCandidate[] = [
      { n: 1, id: STEVEN, name: "Steven Jacobs" },
      { n: 2, id: STEVEN2, name: "Steven Adams" },
      { n: 3, id: VICKI, name: "Vicki-Leigh Atkinson" },
      { n: 4, id: CAYLA, name: "Cayla Rosenblatt" },
    ];
    const cases: Array<[string, string[] | null]> = [
      ["all", [STEVEN, STEVEN2, VICKI, CAYLA]],
      ["all 4", [STEVEN, STEVEN2, VICKI, CAYLA]],
      ["all of them", [STEVEN, STEVEN2, VICKI, CAYLA]],
      ["all 3", null],
      ["1 and 3", [STEVEN, VICKI]],
      ["the first one", [STEVEN]],
      ["first and third", [STEVEN, VICKI]],
      ["Vicki", [VICKI]],
      ["cayla and steven jacobs", [CAYLA, STEVEN]],
      ["no idea", null],
    ];
    for (const [text, ids] of cases) expect(resolveChoice(text, candidates), text).toEqual(ids);
    expect(addedNames("and Steven too")).toEqual(["steven"]);
    expect(addedNames("also Vicki")).toEqual(["vicki"]);
    expect(addedNames("how are my clients doing")).toBeNull();
  });

  it("matches a hyphenated first name and refuses someone who is not on the list", () => {
    const clients = [
      { id: VICKI, full_name: "Vicki-Leigh Atkinson" },
      { id: STEVEN, full_name: "Steven Jacobs" },
      { id: STEVEN2, full_name: "Steven Adams" },
    ];
    expect(resolveNames(["vicki"], clients)).toEqual([
      { query: "vicki", status: "one", client: clients[0] },
    ]);
    expect(resolveNames(["steven"], clients)[0].status).toBe("many");
    expect(resolveNames(["beyonce"], clients)[0].status).toBe("none");
    expect(
      joinNames(["Cayla Rosenblatt", "Michaela Geldhof", "Steven Jacobs", "Vicki-Leigh Atkinson"]),
    ).toBe("Cayla Rosenblatt, Michaela Geldhof, Steven Jacobs and Vicki-Leigh Atkinson");
  });
});

describe("Justin's 11 Oct chat", () => {
  it("lists the practitioners on the practice, and nobody else", async () => {
    let calls = 0;
    const { db, deps, replies } = harness({
      understand: async () => {
        calls++;
        return { tool: "list_practitioners" };
      },
    });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "please tell me all the practitioners you have listed", replyId: null },
      deps,
    );
    expect(calls).toBe(1);
    expect(replies[0].body).toContain("Justin Owner");
    expect(replies[0].body).toContain("Zoe Naude");
    expect(replies[0].body).toContain("Tristan Botha");
    expect(replies[0].body).not.toContain("Beyonce");
    expect(replies[0].body).not.toContain("Cayla");
  });

  it("a practitioner who is not an owner or admin only sees themselves", async () => {
    const { db, deps, replies } = harness({
      understand: async () => ({ tool: "list_practitioners" }),
    });
    await handlePractitionerMessage(
      asAdmin(db),
      ZOE,
      { text: "who are the practitioners?", replyId: null },
      deps,
    );
    expect(replies[0].body).toContain("only practitioner");
    expect(replies[0].body).toContain("Zoe");
    expect(replies[0].body).not.toContain("Tristan");
    expect(replies[0].body).not.toContain("Justin");
  });

  it("reads Lauren from the model's tool, and still reads her if the model is down", async () => {
    let calls = 0;
    const { db, deps, replies } = harness({
      understand: async () => {
        calls++;
        return { tool: "read_messages", names: ["lauren"] };
      },
    });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "lauren wat she say", replyId: null },
      deps,
    );
    expect(calls).toBe(1);
    expect(replies[0].body).toContain("knee felt easier");
    expect(replies[0].body).toContain("Lauren");

    const down = harness({ understand: async () => null });
    await handlePractitionerMessage(
      asAdmin(down.db),
      JUSTIN,
      { text: "what was laurens message", replyId: null },
      down.deps,
    );
    expect(down.replies[0].body).toContain("knee felt easier");
  });

  it("confirms one check-in for all four, then sends and reports each result", async () => {
    process.env.WHATSAPP_REMINDER_TEMPLATE = "buddy_checkin_reminder";
    const seen: AgentTurnInput[] = [];
    const { db, deps, replies, sent } = harness({
      understand: async (input) => {
        seen.push(input);
        return CHECKIN_FOUR;
      },
    });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: FOUR, replyId: null },
      deps,
      memory,
    );
    expect(sent).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
    expect(replies[0].body).toBe(
      `I'll message Cayla Rosenblatt, Michaela Geldhof, Steven Jacobs and Vicki-Leigh Atkinson: "${PREVIEW}" Send?`,
    );
    expect(replies[0]?.buttons?.map((b) => b.id)).toEqual([
      "prac_ag_yes",
      "prac_ag_edit",
      "prac_ag_no",
    ]);

    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "All 4", replyId: null },
      deps,
      memory,
    );
    expect(seen).toHaveLength(1);
    const texts = sent.filter((m) => m.kind === "text").map((m) => m.to);
    const templates = sent.filter((m) => m.kind === "template");
    expect(texts).toEqual(["27821111111"]);
    expect(textSent(sent)).toBe(
      "Hi Cayla, it's Buddy from Peak Movement, checking in on how you're doing.",
    );
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      to: "27822222222",
      templateName: "buddy_checkin_reminder",
      variables: ["Michaela"],
    });
    expect(push).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-steven", title: "Buddy check-in" }),
    );
    const report = replies[1].body as string;
    expect(report).toContain("Cayla Rosenblatt: messaged on WhatsApp.");
    expect(report).toContain(
      "Michaela Geldhof: outside the 24 hour window, so I sent the check-in template.",
    );
    expect(report).toContain(
      "Steven Jacobs: not on WhatsApp with me, so I sent a notification in the Buddy app.",
    );
    expect(report).toContain("Vicki-Leigh Atkinson: isn't on Buddy yet");
    expect(report).not.toMatch(/pain \d/);
  });

  it("keeps the four names across a saved draft, so All 4 still works", async () => {
    process.env.WHATSAPP_REMINDER_TEMPLATE = "buddy_checkin_reminder";
    const { db, deps, sent } = harness({ understand: async () => CHECKIN_FOUR });
    let draft: Record<string, unknown> = { notes: ["keep"] };
    const say = async (text: string) => {
      const memory = readPracMemory(draft, NOW.getTime());
      await handlePractitionerMessage(asAdmin(db), JUSTIN, { text, replyId: null }, deps, memory);
      draft = writePracMemory(draft, memory);
    };
    await say(FOUR);
    expect(sent).toHaveLength(0);
    expect(readPracMemory(draft, NOW.getTime()).pending?.kind).toBe("outbound");
    await say("All 4");
    expect(sent.length).toBeGreaterThan(0);
    expect((draft as { notes?: string[] }).notes).toEqual(["keep"]);
  });

  it.each(["Yes", "yes", "go ahead"])("sends when they say %s", async (text) => {
    const { db, deps, sent } = harness({ understand: async () => CHECKIN_FOUR });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: FOUR, replyId: null },
      deps,
      memory,
    );
    await handlePractitionerMessage(asAdmin(db), JUSTIN, { text, replyId: null }, deps, memory);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("the Yes button sends, Cancel sends nothing, Edit changes the wording", async () => {
    const { db, deps, replies, sent } = harness({ understand: async () => CHECKIN_FOUR });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: FOUR, replyId: null },
      deps,
      memory,
    );
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "", replyId: "prac_ag_no" },
      deps,
      memory,
    );
    expect(sent).toHaveLength(0);
    expect(replyText(replies)).toBe("Okay, I won't.");

    const again: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: FOUR, replyId: null },
      deps,
      again,
    );
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "", replyId: "prac_ag_edit" },
      deps,
      again,
    );
    expect(replyText(replies)).toBe("What should I say instead?");
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "mention that the race is on Saturday", replyId: null },
      deps,
      again,
    );
    expect(replyText(replies)).toContain("The race is on Saturday");
    expect(sent).toHaveLength(0);
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "", replyId: "prac_ag_yes" },
      deps,
      again,
    );
    expect(textSent(sent)).toContain("The race is on Saturday");
  });
});

describe("ambiguous names", () => {
  it("asks with a numbered list, then the first one, 1 and 3, or all", async () => {
    const script: unknown[] = [
      { tool: "send_checkin", names: ["steven"] },
      { tool: "client_status", names: ["steven", "vicki", "cayla"] },
    ];
    const { db, deps, replies, sent } = harness({
      extraStevens: true,
      understand: async () => script.shift() ?? null,
    });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "please contact steven and ask how he is, make sure to say hi", replyId: null },
      deps,
      memory,
    );
    expect(replies[0].body).toContain("1. Steven");
    expect(replies[0].body).toContain("2. Steven");
    expect(replies[0].body).toContain('Reply with a number, a name, or "all".');
    expect(sent).toHaveLength(0);

    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "the first one", replyId: null },
      deps,
      memory,
    );
    expect(replies[1].body).toContain("Steven Jacobs");
    expect(replies[1].body).not.toContain("Steven Adams");
    expect(sent).toHaveLength(0);

    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "how are steven, vicki and cayla", replyId: null },
      deps,
      memory,
    );
    expect(replyText(replies)).toContain("1. Steven");
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "all", replyId: null },
      deps,
      memory,
    );
    const body = replyText(replies);
    expect(body).toContain("Steven Jacobs");
    expect(body).toContain("Steven Adams");
    expect(body).toContain("Vicki-Leigh Atkinson");
    expect(body).toContain("Cayla Rosenblatt");
    expect(body).toContain("pain 4/10");
    expect(body).not.toContain("pain 9");
  });

  it("adds Steven to a confirmation that is already on screen", async () => {
    let calls = 0;
    const { db, deps, replies, sent } = harness({
      understand: async () => {
        calls++;
        return { tool: "send_checkin", names: ["cayla", "michaela"] };
      },
    });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "contact cayla and michaela and ask how they are", replyId: null },
      deps,
      memory,
    );
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "and Steven too", replyId: null },
      deps,
      memory,
    );
    expect(calls).toBe(1);
    expect(replyText(replies)).toContain("Cayla Rosenblatt");
    expect(replyText(replies)).toContain("Michaela Geldhof");
    expect(replyText(replies)).toContain("Steven Jacobs");
    expect(sent).toHaveLength(0);
  });
});

describe("scope, and the model cannot invent anyone", () => {
  it("a practitioner cannot see or message another practitioner's client", async () => {
    const { db, deps, replies, sent } = harness({
      understand: async () => ({ tool: "client_status", names: ["vicki"] }),
    });
    await handlePractitionerMessage(
      asAdmin(db),
      ZOE,
      { text: "how is vicki doing, and tell me if anything is open", replyId: null },
      deps,
    );
    expect(replies[0].body).toMatch(/couldn't find vicki/i);
    expect(replies[0].body).not.toContain("Atkinson");
    expect(sent).toHaveLength(0);

    const send = harness({
      understand: async () => ({ tool: "send_checkin", names: ["vicki", "cayla"] }),
    });
    await handlePractitionerMessage(
      asAdmin(send.db),
      ZOE,
      { text: "check in with vicki and cayla", replyId: null },
      send.deps,
    );
    expect(send.replies[0].body).toMatch(/couldn't find vicki/i);
    expect(replyText(send.replies)).toContain("Cayla Rosenblatt");
    expect(replyText(send.replies)).not.toContain("Vicki-Leigh");
    expect(send.sent).toHaveLength(0);
  });

  it("an unknown name is not confirmed and not messaged", async () => {
    const { db, deps, replies, sent } = harness({
      understand: async () => ({ tool: "send_checkin", names: ["Beyonce"] }),
    });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "message Beyonce", replyId: null },
      deps,
    );
    expect(replies[0].body).toMatch(/couldn't find Beyonce/i);
    expect(replies[0].buttons).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("status for one client uses the check-in on file", async () => {
    const { db, deps, replies } = harness({
      understand: async () => ({ tool: "client_status", names: ["cayla"] }),
    });
    await handlePractitionerMessage(
      asAdmin(db),
      ZOE,
      { text: "how is cayla doing", replyId: null },
      deps,
    );
    expect(replies[0].body).toContain("Cayla Rosenblatt");
    expect(replies[0].body).toContain("pain 4/10");
    expect(replies[0].body).toContain("knee felt easier");
  });
});

describe("the other tools, still only from real rows", () => {
  const tools: Array<[string, Partial<AgentDecision>, RegExp]> = [
    ["practice_overview", { tool: "practice_overview" }, /Red flags|Buddy usage|Gone quiet/],
    ["red_flags", { tool: "red_flags" }, /No open red flags/],
    ["quiet_clients", { tool: "quiet_clients" }, /Gone quiet|quiet/],
    ["usage", { tool: "usage" }, /Buddy usage/],
    ["read_messages", { tool: "read_messages", names: ["lauren"] }, /knee felt easier/],
    [
      "schedule_updates",
      { tool: "schedule_updates", frequency: "daily", time: "07:00" },
      /every day at 7am/,
    ],
  ];
  it.each(tools)(
    "%s answers from the tool, not from a made-up sentence",
    async (_name, decision, pattern) => {
      const { db, deps, replies, sent } = harness({
        understand: async () => ({
          names: [],
          note: null,
          task: null,
          question: null,
          frequency: null,
          weekday: null,
          time: null,
          ...decision,
        }),
      });
      await handlePractitionerMessage(
        asAdmin(db),
        JUSTIN,
        { text: `please ${_name}`, replyId: null },
        deps,
      );
      expect(replies[0].body).toMatch(pattern);
      expect(replies[0].body).not.toContain("Beyonce");
      expect(sent).toHaveLength(0);
    },
  );

  it("programme sent and reception both wait for yes", async () => {
    const { db, deps, replies, sent } = harness({
      understand: async () => ({ tool: "programme_sent", names: ["cayla", "steven"] }),
    });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "I've sent cayla and steven their programmes", replyId: null },
      deps,
      memory,
    );
    expect(replies[0].body).toBe(
      "I'll tell Cayla Rosenblatt and Steven Jacobs their programme is ready. Send?",
    );
    expect(sent).toHaveLength(0);
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "yes", replyId: null },
      deps,
      memory,
    );
    expect(sent.some((m) => m.to === "27821111111")).toBe(true);
    expect(push).toHaveBeenCalled();

    process.env.WHATSAPP_RECEPTION_NUMBER = "+27820000099";
    const reception = harness({
      understand: async () => ({ tool: "ask_reception", task: "Book Sam for Thursday" }),
    });
    const mem: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(reception.db),
      JUSTIN,
      { text: "please arrange Thursday for Sam", replyId: null },
      reception.deps,
      mem,
    );
    expect(reception.replies[0].body).toBe("I'll ask reception to book Sam for Thursday. Send?");
    expect(reception.db.t.reception_requests).toHaveLength(0);
    await handlePractitionerMessage(
      asAdmin(reception.db),
      JUSTIN,
      { text: "yes", replyId: null },
      reception.deps,
      mem,
    );
    expect(reception.db.t.reception_requests).toHaveLength(1);
    expect(String(reception.db.t.reception_requests[0]?.request_text)).toContain(
      "Book Sam for Thursday",
    );
  });

  it("does not offer Heidi until the secrets are set, then still needs a real client", async () => {
    const off = harness({
      understand: async (input) => {
        expect(input.heidiEnabled).toBe(false);
        return { tool: "heidi_read", names: ["Cayla Rosenblatt"] };
      },
    });
    await handlePractitionerMessage(
      asAdmin(off.db),
      JUSTIN,
      { text: "what does heidi say about Cayla Rosenblatt", replyId: null },
      off.deps,
    );
    expect(replyText(off.replies)).toContain("isn't connected");

    process.env.HEIDI_API_KEY = "k";
    process.env.HEIDI_REGION = "eu";
    process.env.HEIDI_EHR_PROVIDER = "buddy";
    const on = harness({
      understand: async (input) => {
        expect(input.heidiEnabled).toBe(true);
        return { tool: "heidi_read", names: ["Cayla Rosenblatt"] };
      },
    });
    await handlePractitionerMessage(
      asAdmin(on.db),
      JUSTIN,
      { text: "please check heidi", replyId: null },
      on.deps,
    );
    expect(replyText(on.replies)).toBe(HEIDI_MSG.noEmail);
  });
});

describe("when the model fails, the phrase matcher still answers", () => {
  it("a thrown or empty model falls back, and does not message anyone", async () => {
    for (const understand of [
      async () => null,
      async () => {
        throw new Error("gateway 500");
      },
    ]) {
      const { db, deps, replies, sent } = harness({ understand });
      await handlePractitionerMessage(asAdmin(db), JUSTIN, { text: FOUR, replyId: null }, deps);
      expect(sent).toHaveLength(0);
      expect(replies[0].body).toContain("Who should I ask?");
    }
  });

  it("an ordinary unknown line asks one short question, with a suggestion", async () => {
    const { db, deps, replies } = harness({ understand: async () => null });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "blue elephant", replyId: null },
      deps,
    );
    expect(replies[0].body).toBe(PRAC_MSG.notSure("Justin"));
    expect(replies[0].body).toContain("how are my clients doing?");
  });

  it("an exact status command skips the model; a programme line confirms when the model is up", async () => {
    let calls = 0;
    const { db, deps, replies, sent } = harness({
      understand: async () => {
        calls++;
        return { tool: "programme_sent", names: ["Cayla Rosenblatt"] };
      },
    });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "how are my clients doing?", replyId: null },
      deps,
    );
    expect(calls).toBe(0);
    expect(replies[0].body).toContain("Here's how your clients are doing");
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "I've sent Cayla Rosenblatt her programme", replyId: null },
      deps,
    );
    expect(calls).toBe(1);
    expect(sent).toHaveLength(0);
    expect(replyText(replies)).toContain("programme is ready");
  });

  it("does not call Gemini during tests when no mock is passed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.LOVABLE_API_KEY = "test-key";
    const { db, deps } = harness();
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "blue elephant", replyId: null },
      deps,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    delete process.env.LOVABLE_API_KEY;
    expect(await decidePractitionerTurn({ system: "x", messages: [], tools: [] })).toBeNull();
    fetchSpy.mockRestore();
  });
});

describe("terse, garbled and multi-ask messages", () => {
  const corpus: Array<{ text: string; decision: unknown; pattern: RegExp }> = [
    {
      text: "cayla?",
      decision: { tool: "client_status", names: ["cayla"] },
      pattern: /Cayla Rosenblatt[\s\S]*pain 4\/10/,
    },
    {
      text: "cayla",
      decision: { tool: "client_status", names: ["cayla"] },
      pattern: /knee felt easier/,
    },
    {
      text: "steven??",
      decision: { tool: "client_status", names: ["steven"] },
      pattern: /Steven Jacobs/,
    },
    {
      text: "vicki status pls",
      decision: { tool: "client_status", names: ["vicki"] },
      pattern: /Vicki-Leigh Atkinson/,
    },
    {
      text: "msg the quiet ones",
      decision: { tool: "send_checkin", names: ["quiet"] },
      pattern: /Michaela Geldhof/,
    },
    {
      text: "message the quiet clients",
      decision: { tool: "send_checkin", names: ["the quiet ones"] },
      pattern: /Michaela Geldhof/,
    },
    {
      text: "lauren wat she say",
      decision: { tool: "read_messages", names: ["lauren"] },
      pattern: /knee felt easier/,
    },
    {
      text: "laurens msg",
      decision: { tool: "read_messages", names: ["lauren"] },
      pattern: /Lauren/,
    },
    {
      text: "wat het lauren gesê",
      decision: { tool: "read_messages", names: ["lauren"] },
      pattern: /Lauren/,
    },
    {
      text: "hoe gaan dit met cayla",
      decision: { tool: "client_status", names: ["cayla"] },
      pattern: /pain 4\/10/,
    },
    {
      text: "pls ping steven",
      decision: { tool: "send_checkin", names: ["steven"] },
      pattern: /Steven Jacobs[\s\S]*Send\?/,
    },
    {
      text: "chk in w cayla n steven",
      decision: { tool: "send_checkin", names: ["cayla", "steven"] },
      pattern: /Cayla Rosenblatt and Steven Jacobs/,
    },
    {
      text: "um yeah can you check on cayla for me real quick",
      decision: { tool: "client_status", names: ["cayla"] },
      pattern: /Cayla Rosenblatt/,
    },
    {
      text: "uh so the programme is ready for cayla thanks",
      decision: { tool: "programme_sent", names: ["cayla"] },
      pattern: /programme is ready/,
    },
    {
      text: "book thursday at reception for the front desk pls",
      decision: { tool: "ask_reception", task: "Book Thursday" },
      pattern: /reception/,
    },
    { text: "red flags??", decision: { tool: "red_flags" }, pattern: /[Rr]ed flag/ },
    { text: "usage?", decision: { tool: "usage" }, pattern: /Buddy usage/ },
    { text: "quiet?", decision: { tool: "quiet_clients" }, pattern: /quiet/ },
    {
      text: "who's the physios",
      decision: { tool: "list_practitioners" },
      pattern: /Justin Owner/,
    },
    { text: "wat cn u do", decision: { tool: "help" }, pattern: /Here's what I can do/ },
    {
      text: "update me weekdays at 7",
      decision: { tool: "schedule_updates", frequency: "weekdays", time: "07:00" },
      pattern: /weekday/,
    },
    {
      text: "👍",
      decision: {
        tool: "clarify",
        question: "What should I do with that?",
        options: ["How's Cayla", "My messages"],
      },
      pattern: /What should I do with that\?/,
    },
    {
      text: "❓",
      decision: {
        tool: "clarify",
        question: "Whose update do you want?",
        options: ["Cayla", "Steven"],
      },
      pattern: /Whose update/,
    },
    {
      text: "all of them",
      decision: { tool: "client_status", names: ["all"] },
      pattern: /clients are doing|Cayla Rosenblatt/,
    },
    {
      text: "message beyonce now",
      decision: { tool: "send_checkin", names: ["Beyonce"] },
      pattern: /couldn't find Beyonce/,
    },
  ];

  it.each(corpus)("$text", async ({ text, decision, pattern }) => {
    let calls = 0;
    const { db, deps, replies, sent } = harness({
      understand: async () => {
        calls++;
        return decision;
      },
    });
    await handlePractitionerMessage(asAdmin(db), JUSTIN, { text, replyId: null }, deps);
    expect(calls, text).toBe(1);
    expect(replies.map((r) => r.body).join("\n"), text).toMatch(pattern);
    expect(sent, text).toHaveLength(0);
    expect(replies.map((r) => r.body).join("\n")).not.toContain("didn't quite get that");
  });

  it("one sentence can answer and then ask to send", async () => {
    const { db, deps, replies, sent } = harness({
      understand: async () => [
        { tool: "client_status", names: ["cayla"] },
        { tool: "quiet_clients" },
        { tool: "send_checkin", names: ["steven"], note: "the race is saturday" },
      ],
    });
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      {
        text: "how's cayla doing and who's gone quiet and message steven the race is saturday",
        replyId: null,
      },
      deps,
    );
    const body = replies.map((r) => r.body).join("\n");
    expect(body).toContain("pain 4/10");
    expect(body).toMatch(/quiet/i);
    expect(body).toContain("Steven Jacobs");
    expect(body).toContain("The race is saturday");
    expect(sent).toHaveLength(0);
  });

  it("ye do it and a thumbs up confirm the pending send", async () => {
    for (const answer of ["ye do it", "👍"]) {
      const script = [{ tool: "send_checkin", names: ["cayla"] }, { tool: "confirm_pending" }];
      const { db, deps, replies, sent } = harness({
        understand: async () => script.shift() ?? null,
      });
      const memory: PracMemory = {};
      await handlePractitionerMessage(
        asAdmin(db),
        JUSTIN,
        { text: "ping cayla", replyId: null },
        deps,
        memory,
      );
      expect(sent).toHaveLength(0);
      await handlePractitionerMessage(
        asAdmin(db),
        JUSTIN,
        { text: answer, replyId: null },
        deps,
        memory,
      );
      expect(sent.some((m) => m.kind === "text" && m.to === "27821111111")).toBe(true);
      expect(replies.map((r) => r.body).join("\n")).toContain("messaged on WhatsApp");
    }
  });

  it("her, those and the ones you mentioned follow the last client and the last list", async () => {
    const script = [
      { tool: "client_status", names: ["cayla"] },
      { tool: "read_messages", names: ["her"] },
      { tool: "client_status", names: ["cayla", "steven", "vicki"] },
      { tool: "send_checkin", names: ["the ones you mentioned"] },
    ];
    const seen: string[] = [];
    const { db, deps, replies, sent } = harness({
      understand: async (input) => {
        seen.push(input.context);
        return script.shift() ?? null;
      },
    });
    const memory: PracMemory = {};
    const say = (text: string) =>
      handlePractitionerMessage(asAdmin(db), JUSTIN, { text, replyId: null }, deps, memory);
    await say("cayla?");
    expect(replies[0].body).toContain("pain 4/10");
    await say("her messages");
    expect(replyText(replies)).toContain("Cayla");
    expect(replyText(replies)).not.toContain("Lauren says");
    await say("and steven and vicki");
    await say("check in with those");
    const body = replyText(replies);
    expect(body).toContain("Cayla Rosenblatt");
    expect(body).toContain("Steven Jacobs");
    expect(body).toContain("Vicki-Leigh Atkinson");
    expect(sent).toHaveLength(0);
    expect(seen[1]).toContain("Cayla Rosenblatt");
    expect(seen[3]).toContain("Steven Jacobs");
    expect(expandReferences(["her"], memory.focus).names).toEqual([]);
  });

  it("a clarifying question has buttons, and the tap is the next message", async () => {
    const { db, deps, replies } = harness({
      understand: async (input) => {
        if (input.message === "Her status") return { tool: "client_status", names: ["cayla"] };
        return {
          tool: "clarify",
          question: "Cayla's status, or her messages?",
          options: ["Her status", "Her messages"],
        };
      },
    });
    const memory: PracMemory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "cayla??", replyId: null },
      deps,
      memory,
    );
    expect(replies[0].body).toBe("Cayla's status, or her messages?");
    expect(replies[0].buttons?.map((b) => b.title)).toEqual(["Her status", "Her messages"]);
    await handlePractitionerMessage(
      asAdmin(db),
      JUSTIN,
      { text: "", replyId: "prac_cl_0" },
      deps,
      memory,
    );
    expect(replyText(replies)).toContain("pain 4/10");
  });
});
