import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: vi.fn(async () => ({})) }));

import { log } from "@/lib/log";
import {
  MORNING_BUTTONS,
  MORNING_MSG,
  morningCheckinDue,
  morningNameParts,
  morningPhrase,
} from "./morning-checkin";
import { runMorningCheckins } from "./morning-checkin.server";
import { handlePractitionerMessage, type PractitionerDeps } from "./practitioner-mode.server";
import {
  buildPractitionerPrompt,
  practitionerToolSchemas,
  type AgentTurnInput,
} from "./practitioner-agent";
import { practitionerIntent, runPractitionerJobs } from "./practitioner-status.server";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";

// Friday 9 Oct 2026, 08:00 SAST.
const AT_EIGHT = new Date("2026-10-09T06:00:00Z");
const AT_NOON = new Date("2026-10-09T10:00:00Z");
const daysBefore = (at: Date, d: number) => new Date(at.getTime() - d * 86_400_000).toISOString();
const SAM = "11111111-1111-1111-1111-111111111111";
const LEE = "33333333-3333-3333-3333-333333333333";
const ANN = "44444444-4444-4444-4444-444444444444";

type Row = Record<string, unknown>;
type AdminClient = Parameters<typeof handlePractitionerMessage>[0];

interface FakeQuery extends PromiseLike<{ data: Row[]; error: null }> {
  select: (columns?: string) => FakeQuery;
  eq: (k: string, v: unknown) => FakeQuery;
  neq: (k: string, v: unknown) => FakeQuery;
  in: (k: string, v: unknown[]) => FakeQuery;
  is: (k: string, v: unknown) => FakeQuery;
  gte: (k: string, v: unknown) => FakeQuery;
  gt: (k: string, v: unknown) => FakeQuery;
  order: () => FakeQuery;
  limit: (n?: number) => FakeQuery;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  update: (p: Row) => FakeQuery;
  insert: (r: Row) => Promise<{ error: null }>;
}

function fakeDb(
  t: Record<string, Row[]>,
  phones: Record<string, string | null> = { zoe: "27692047284" },
) {
  const from = (table: string): FakeQuery => {
    const f: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const rows = () => (t[table] ??= []).filter((r) => f.every((x) => x(r)));
    const done = () => {
      const hit = rows();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: hit, error: null as null };
    };
    const api: FakeQuery = {
      select: () => api,
      eq: (k, v) => (f.push((r) => r[k] === v), api),
      neq: (k, v) => (f.push((r) => r[k] !== v), api),
      in: (k, v) => (f.push((r) => v.includes(r[k])), api),
      is: (k, v) => (f.push((r) => (r[k] ?? null) === v), api),
      gte: (k, v) => (f.push((r) => String(r[k] ?? "") >= String(v)), api),
      gt: (k, v) => (f.push((r) => String(r[k] ?? "") > String(v)), api),
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      update: (p) => ((patch = p), api),
      insert: (r) => ((t[table] ??= []).push(r), Promise.resolve({ error: null })),
      then: (res, rej) => Promise.resolve(done()).then(res, rej),
    };
    return api;
  };
  return {
    from,
    t,
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: phones[id] ? { id, phone: phones[id] } : null },
        }),
      },
    },
  };
}

const asAdmin = (db: ReturnType<typeof fakeDb>) => db as unknown as AdminClient;

function world(at = AT_EIGHT) {
  return fakeDb({
    practices: [{ id: "pm", practitioner_id: "justin", practice_name: "Peak Movement" }],
    practice_members: [{ user_id: "zoe", practice_id: "pm", status: "active", role: "member" }],
    profiles: [{ id: "zoe", full_name: "Zoe Bredenkamp", role: "practitioner" }],
    clients: [
      {
        id: SAM,
        full_name: "Sam Kruger",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysBefore(at, 20),
        auth_user_id: null,
      },
      {
        id: LEE,
        full_name: "Lee Adams",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysBefore(at, 20),
        auth_user_id: "u-lee",
      },
      {
        id: ANN,
        full_name: "Ann Old",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysBefore(at, 200),
        auth_user_id: null,
      },
    ],
    check_ins: [
      {
        client_id: SAM,
        pain_level: 7,
        sleep_quality: 2,
        energy_level: 3,
        notes: "knee swollen",
        created_at: daysBefore(at, 1),
      },
      {
        client_id: SAM,
        pain_level: 4,
        sleep_quality: 3,
        energy_level: 3,
        notes: null,
        created_at: daysBefore(at, 3),
      },
      {
        client_id: LEE,
        pain_level: 2,
        sleep_quality: 4,
        energy_level: 4,
        notes: null,
        created_at: daysBefore(at, 6),
      },
    ],
    alerts: [
      {
        id: "al-sam",
        client_id: SAM,
        practitioner_id: "zoe",
        alert_type: "red_flag",
        urgency: "urgent",
        created_at: daysBefore(at, 0.2),
        message: "Pain rose 3 points since the last check-in (4 to 7)",
        is_read: false,
        reviewed_at: null,
        push_fired: false,
      },
    ],
    whatsapp_conversations: [
      { id: "c1", client_id: SAM, phone: "27820000001", opted_out_at: null, state: "idle" },
    ],
    whatsapp_inbound: [{ from_phone: "27692047284", received_at: daysBefore(at, 0.05) }],
    whatsapp_outbound: [],
    practitioner_checkin_requests: [],
    practitioner_update_prefs: [],
    practitioner_morning_checkins: [],
    reception_requests: [],
  });
}

const SECRETS: ProviderSecrets = { signingSecret: "test", senderId: "1" };

function providerWith(send: WhatsAppProvider["send"]): WhatsAppProvider {
  return {
    id: "meta",
    verifySignature: async () => true,
    parseWebhook: () => ({ messages: [], statuses: [] }),
    send,
  };
}

function envFor(send: WhatsAppProvider["send"] = async () => ({ providerMessageId: "m1" })) {
  const mocked = vi.fn(send);
  return { provider: providerWith(mocked), secrets: SECRETS, send: mocked };
}

afterEach(() => {
  delete process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE;
  delete process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE_LANG;
  delete process.env.WHATSAPP_RECEPTION_NUMBER;
  delete process.env.WHATSAPP_RECEPTION_TEMPLATE;
});

describe("morning check-in window", () => {
  it("is 08:00 to 10:00 SAST on open weekdays", () => {
    expect(morningCheckinDue(AT_EIGHT)).toBe(true);
    expect(morningCheckinDue(new Date("2026-10-09T05:59:00Z"))).toBe(false);
    expect(morningCheckinDue(new Date("2026-10-09T07:59:00Z"))).toBe(true);
    expect(morningCheckinDue(new Date("2026-10-09T08:00:00Z"))).toBe(false);
    expect(morningCheckinDue(AT_NOON)).toBe(false);
    expect(morningCheckinDue(new Date("2026-10-10T06:00:00Z"))).toBe(false);
    expect(morningCheckinDue(AT_EIGHT, new Set(["2026-10-09"]))).toBe(false);
  });

  it("keeps button titles inside WhatsApp's limit", () => {
    expect(MORNING_BUTTONS.map((b) => b.title)).toEqual([
      "Patient update",
      "Reception check-in",
      "Not today",
    ]);
    for (const b of MORNING_BUTTONS) expect(b.title.length).toBeLessThanOrEqual(20);
  });

  it("reads the three replies and the opt-out, and leaves scheduled updates alone", () => {
    expect(morningPhrase("Patient update")).toBe("update");
    expect(morningPhrase("Reception check-in")).toBe("reception");
    expect(morningPhrase("Not today")).toBe("skip");
    expect(morningPhrase("stop morning check-ins")).toBe("off");
    expect(morningPhrase("start morning check-ins")).toBe("on");
    expect(morningPhrase("update me every morning")).toBe(null);
    expect(practitionerIntent("update me every morning", null).kind).toBe("updates");
    expect(practitionerIntent("Patient update", null)).toEqual({
      kind: "status_all",
      practice: false,
    });
    expect(practitionerIntent("reception check-in", null)).toEqual({ kind: "morning_reception" });
    expect(practitionerIntent("", "prac_morn_skip")).toEqual({ kind: "morning_skip" });
    expect(practitionerIntent("stop morning check-ins", null)).toEqual({
      kind: "morning_prefs",
      enabled: false,
    });
    expect(morningNameParts("Sam Kruger and Lee Adams")).toEqual(["Sam Kruger", "Lee Adams"]);
  });
});

describe("sending the morning note", () => {
  it("asks once, with buttons, inside the 24 hour window", async () => {
    const db = world();
    const { send, ...env } = envFor();
    await runPractitionerJobs(asAdmin(db), env, AT_EIGHT);
    await runMorningCheckins(asAdmin(db), env, AT_EIGHT);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      kind: "buttons",
      to: "27692047284",
      body: MORNING_MSG.ask("Zoe"),
      buttons: MORNING_BUTTONS,
    });
    expect(db.t.practitioner_morning_checkins[0].last_sent_on).toBe("2026-10-09");
  });

  it("does not send at noon, on Saturday, or to someone with no current patient", async () => {
    const noon = world(AT_NOON);
    const { send, ...env } = envFor();
    await runMorningCheckins(asAdmin(noon), env, AT_NOON);
    await runMorningCheckins(asAdmin(world()), env, new Date("2026-10-10T06:00:00Z"));
    const quiet = world();
    quiet.t.clients = [
      {
        id: ANN,
        full_name: "Ann Old",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysBefore(AT_EIGHT, 200),
        auth_user_id: null,
      },
    ];
    quiet.t.check_ins = [];
    quiet.t.alerts = [];
    await runMorningCheckins(asAdmin(quiet), env, AT_EIGHT);
    expect(send).not.toHaveBeenCalled();
    expect(quiet.t.practitioner_morning_checkins).toEqual([]);
  });

  it("skips an opted-out practitioner", async () => {
    const db = world();
    db.t.practitioner_morning_checkins = [
      { practitioner_id: "zoe", enabled: false, last_sent_on: null },
    ];
    const { send, ...env } = envFor();
    await runMorningCheckins(asAdmin(db), env, AT_EIGHT);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the template outside the window, and skips with a log when it is unset", async () => {
    const db = world();
    db.t.whatsapp_inbound = [{ from_phone: "27692047284", received_at: "2026-10-01T00:00:00Z" }];
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const skipped = envFor();
    await runMorningCheckins(asAdmin(db), skipped, AT_EIGHT);
    expect(skipped.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "morning check-in skipped: window closed and no template",
      expect.objectContaining({ to: expect.any(String) }),
    );
    expect(db.t.practitioner_morning_checkins[0].last_sent_on).toBe("2026-10-09");

    const again = world();
    again.t.whatsapp_inbound = db.t.whatsapp_inbound;
    process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE = "buddy_morning_checkin";
    process.env.WHATSAPP_MORNING_CHECKIN_TEMPLATE_LANG = "en";
    const templated = envFor();
    await runMorningCheckins(asAdmin(again), templated, AT_EIGHT);
    expect(templated.send.mock.calls[0][0]).toMatchObject({
      kind: "template",
      to: "27692047284",
      templateName: "buddy_morning_checkin",
      languageCode: "en",
      variables: ["Zoe"],
      buttonPayloads: ["prac_morn_update", "prac_morn_reception", "prac_morn_skip"],
    });
    warn.mockRestore();
  });

  it("retries when the send fails", async () => {
    const db = world();
    let n = 0;
    const send = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("meta down");
      return { providerMessageId: "m2" };
    });
    const env = envFor(send);
    await runMorningCheckins(asAdmin(db), env, AT_EIGHT);
    await runMorningCheckins(asAdmin(db), env, new Date(AT_EIGHT.getTime() + 60_000));
    expect(send).toHaveBeenCalledTimes(2);
    expect(db.t.practitioner_morning_checkins[0].last_sent_on).toBe("2026-10-09");
  });
});

describe("replies", () => {
  const PRAC = { userId: "zoe", firstName: "Zoe" };

  function deps(at = AT_NOON, understand?: (input: AgentTurnInput) => Promise<unknown>) {
    const replies: Array<{ body: string; buttons?: Array<{ id: string; title: string }> }> = [];
    const sent: OutboundMessage[] = [];
    const requestCheckin = vi.fn(async () => "sent" as const);
    const db = world(at);
    const d: PractitionerDeps = {
      provider: providerWith(async (message) => {
        sent.push(message);
        return { providerMessageId: "w" };
      }),
      secrets: SECRETS,
      now: at,
      understand,
      requestCheckin,
      reply: async (message) => {
        if ("body" in message) replies.push(message);
      },
    };
    return { db, replies, sent, requestCheckin, d };
  }

  it("Patient update reuses the caseload summary", async () => {
    const { db, replies, d } = deps();
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "", replyId: "prac_morn_update" },
      d,
    );
    expect(replies[0].body).toContain("Here's how your clients are doing, Zoe");
    expect(replies[0].body).toContain("Sam Kruger");
    expect(replies[0].body).toContain("red flag");
    expect(replies[0].body).toContain("Gone quiet");
    expect(replies[0].body).toContain("Lee Adams");
    expect(replies[0].body).not.toContain("Ann Old");
  });

  it("Not today does not opt out", async () => {
    const { db, replies, d } = deps();
    await handlePractitionerMessage(asAdmin(db), PRAC, { text: "Not today", replyId: null }, d);
    expect(replies[0].body).toBe(MORNING_MSG.skipped);
    expect(db.t.practitioner_morning_checkins).toEqual([]);
  });

  it("stop morning check-ins opts out, and start turns it back on", async () => {
    const { db, replies, d } = deps();
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "stop morning check-ins", replyId: null },
      d,
    );
    expect(replies[0].body).toBe(MORNING_MSG.optedOut);
    expect(db.t.practitioner_morning_checkins[0]).toMatchObject({
      practitioner_id: "zoe",
      enabled: false,
    });
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "start morning check-ins", replyId: null },
      d,
    );
    expect(db.t.practitioner_morning_checkins[0].enabled).toBe(true);
  });

  it("Reception check-in confirms names before any outbound, including a typed yes the model would have sent", async () => {
    const understand = vi.fn(async () => ({ tool: "send_checkin", names: ["Sam Kruger"] }));
    const { db, replies, sent, requestCheckin, d } = deps(AT_NOON, understand);
    process.env.WHATSAPP_RECEPTION_NUMBER = "+27820000099";
    const memory = {};
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "", replyId: "prac_morn_reception" },
      d,
      memory,
    );
    expect(replies[0].body).toBe(MORNING_MSG.who);
    expect(understand).not.toHaveBeenCalled();

    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "Sam Kruger and Lee Adams", replyId: null },
      d,
      memory,
    );
    expect(understand).not.toHaveBeenCalled();
    expect(replies[1].body).toBe("Ask reception to check in with Sam Kruger and Lee Adams?");
    expect(replies[1].buttons?.map((b) => b.title)).toEqual(["Yes", "No"]);
    expect(db.t.reception_requests).toEqual([]);
    expect(sent).toEqual([]);
    expect(requestCheckin).not.toHaveBeenCalled();

    await handlePractitionerMessage(asAdmin(db), PRAC, { text: "yes", replyId: null }, d, memory);
    expect(understand).not.toHaveBeenCalled();
    expect(requestCheckin).not.toHaveBeenCalled();
    expect(sent.every((m) => m.to !== "27820000001")).toBe(true);
    expect(db.t.reception_requests).toHaveLength(1);
    expect(db.t.reception_requests[0].request_text).toBe(
      "Please check in with Sam Kruger and Lee Adams.",
    );
    expect(db.t.reception_requests[0].practitioner_id).toBe("zoe");
  });

  it("a free-text update still goes through the practitioner agent", async () => {
    const { db, replies, d } = deps(AT_NOON, async () => ({
      tool: "client_status",
      names: ["all"],
    }));
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "yes please, send the patient update", replyId: null },
      d,
    );
    expect(replies[0].body).toContain("Here's how your clients are doing, Zoe");
    expect(replies[0].body).toContain("Sam Kruger");
  });

  it("the model can turn the morning note off without sending anything", async () => {
    const { db, replies, sent, d } = deps(AT_NOON, async () => ({
      tool: "set_morning_checkin",
      enabled: false,
    }));
    await handlePractitionerMessage(
      asAdmin(db),
      PRAC,
      { text: "please don't send me that morning note anymore", replyId: null },
      d,
    );
    expect(replies[0].body).toBe(MORNING_MSG.optedOut);
    expect(db.t.practitioner_morning_checkins[0].enabled).toBe(false);
    expect(sent).toEqual([]);
  });

  it("tells the model about the morning note", () => {
    const prompt = buildPractitionerPrompt({
      practitionerName: "Zoe",
      practiceName: "Peak Movement",
      message: "not today thanks",
      history: [],
      pending: null,
      context: "",
      heidiEnabled: false,
      canSeeAllPractitioners: false,
    });
    expect(prompt.system).toContain("dismiss_morning");
    expect(prompt.system).toContain("set_morning_checkin");
    const names = (practitionerToolSchemas(false) as Array<{ function: { name: string } }>).map(
      (t) => t.function.name,
    );
    expect(names).toEqual(expect.arrayContaining(["dismiss_morning", "set_morning_checkin"]));
  });
});
