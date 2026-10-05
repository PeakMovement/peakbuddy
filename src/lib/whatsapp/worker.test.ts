/* eslint-disable @typescript-eslint/no-explicit-any -- test double for supabase-js */
import { describe, expect, it, vi, beforeEach } from "vitest";

// The alert notification cores reach for the real service client. Stub them:
// these tests are about what the worker records and replies, not delivery.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: vi.fn(async () => ({})) }));
vi.mock("@/lib/notify-practitioner.functions", () => ({
  sendAlertEmailCore: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/webhooks.functions", () => ({
  fireAlertWebhookCore: vi.fn(async () => ({ fired: false })),
}));

import { processPendingInbound } from "./worker.server";
import type { OutboundMessage, WhatsAppProvider } from "./provider";
import { IDS } from "./conversation";

/* ------------------------------------------------------------------ */
/* A tiny in-memory stand-in for the parts of supabase-js the worker uses */
/* ------------------------------------------------------------------ */

type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let idSeq = 0;

  function builder(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Row | null = null;
    let inserted: Row[] = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    let head = false;
    let returning = false;

    const run = () => {
      if (op === "insert") return inserted;
      let matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, patch);
        return returning ? matched : [];
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        matched = [...matched].sort(
          (a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1),
        );
      }
      return matched.slice(0, lim);
    };

    const api: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (op !== "select") returning = true;
        if (opts?.head) head = true;
        return api;
      },
      insert(r: Row | Row[]) {
        op = "insert";
        inserted = (Array.isArray(r) ? r : [r]).map((x) => ({
          id: `id-${++idSeq}`,
          created_at: new Date().toISOString(),
          ...x,
        }));
        rows().push(...inserted);
        return api;
      },
      upsert(r: Row, o?: { onConflict?: string }) {
        const key = o?.onConflict ?? "id";
        const existing = rows().find((x) => x[key] === r[key]);
        if (existing) Object.assign(existing, r);
        else rows().push({ id: `id-${++idSeq}`, ...r });
        op = "insert";
        inserted = [];
        return api;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return api;
      },
      eq(c: string, v: any) {
        filters.push((r) => r[c] === v);
        return api;
      },
      neq(c: string, v: any) {
        filters.push((r) => r[c] !== v);
        return api;
      },
      is(c: string, v: any) {
        filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      not(c: string, _op: string, v: any) {
        filters.push((r) => (r[c] ?? null) !== v);
        return api;
      },
      lt(c: string, v: any) {
        filters.push((r) => r[c] != null && r[c] < v);
        return api;
      },
      gte(c: string, v: any) {
        filters.push((r) => r[c] >= v);
        return api;
      },
      order(col: string, o?: { ascending?: boolean }) {
        orderBy = { col, asc: o?.ascending !== false };
        return api;
      },
      limit(n: number) {
        lim = n;
        return api;
      },
      async maybeSingle() {
        const d = run();
        return { data: d[0] ?? null, error: null };
      },
      async single() {
        const d = run();
        return d[0] ? { data: d[0], error: null } : { data: null, error: { code: "PGRST116" } };
      },
      then(resolve: any, reject: any) {
        try {
          const d = run();
          return Promise.resolve(
            head ? { data: null, count: d.length, error: null } : { data: d, error: null },
          ).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).then(resolve, reject);
        }
      },
    };
    return api;
  }

  return { tables, admin: { from: (t: string) => builder(t) } as any };
}

function fakeProvider() {
  const sent: OutboundMessage[] = [];
  const provider: WhatsAppProvider = {
    id: "meta",
    verifySignature: async () => true,
    parseWebhook: () => ({ messages: [], statuses: [] }),
    send: async (m) => {
      sent.push(m);
      return { providerMessageId: `wamid.out.${sent.length}` };
    },
  } as WhatsAppProvider;
  return { provider, sent };
}

const SECRETS = { signingSecret: "x", senderId: "1", accessToken: "t" };

let seq = 0;
function inbound(text: string, replyId?: string, from = "27820000001"): Row {
  seq++;
  return {
    id: `in-${seq}`,
    provider: "meta",
    provider_message_id: `wamid.TEST.${seq}`,
    from_phone: `+${from}`,
    kind: replyId ? "interactive" : "text",
    body: replyId ? "" : text,
    reply_id: replyId ?? null,
    reply_title: replyId ? text : null,
    received_at: new Date(Date.UTC(2026, 9, 5, 7, 0, seq)).toISOString(),
    status: "pending",
  };
}

const CLIENT = {
  id: "client-1",
  full_name: "Test Patient",
  practitioner_id: "prac-1",
  phone: "082 000 0001",
};
const NOW = () => new Date("2026-10-05T07:30:00Z");

describe("WhatsApp worker, end to end against a fake database", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("walks a new patient from first hello through consent to a saved check-in", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [],
      whatsapp_conversations: [],
      consent_records: [],
      check_ins: [],
      alerts: [],
    });
    const { provider, sent } = fakeProvider();
    const env = { admin: db.admin, provider, secrets: SECRETS, now: NOW };
    const say = async (text: string, replyId?: string) => {
      db.tables.whatsapp_inbound.push(inbound(text, replyId));
      return processPendingInbound(env);
    };

    await say("Hi");
    expect(db.tables.whatsapp_conversations[0].client_id).toBe("client-1");
    expect(db.tables.whatsapp_conversations[0].state).toBe("awaiting_consent");
    expect(sent.at(-1)?.kind).toBe("buttons");

    await say("I agree", IDS.consentYes);
    expect(db.tables.consent_records).toHaveLength(1);
    expect(db.tables.consent_records[0]).toMatchObject({
      client_id: "client-1",
      consent_type: "whatsapp_checkins",
      channel: "whatsapp",
    });
    expect(db.tables.consent_records[0].wording_snapshot).toContain("AGREEMENT");

    await say("4");
    await say("4 Well", IDS.sleep(4));
    await say("3");
    await say("Feeling stronger on the stairs");

    expect(db.tables.check_ins).toHaveLength(1);
    expect(db.tables.check_ins[0]).toMatchObject({
      client_id: "client-1",
      practitioner_id: "prac-1",
      pain_level: 4,
      sleep_quality: 4,
      energy_level: 3,
      notes: "Feeling stronger on the stairs",
      flagged: false,
      source: "whatsapp",
    });
    expect(db.tables.whatsapp_conversations[0].state).toBe("awaiting_wearable");
    expect(db.tables.whatsapp_conversations[0].wearable_offer_at).toBeTruthy();
    // Both sides of the conversation are kept for the practitioner.
    expect(db.tables.whatsapp_outbound.length).toBe(sent.length);
    expect(db.tables.whatsapp_outbound.every((r) => r.client_id === "client-1" && r.body)).toBe(
      true,
    );
    expect(
      db.tables.whatsapp_inbound.every(
        (r) => r.status === "processed" && r.client_id === "client-1",
      ),
    ).toBe(true);
    // Every reply went to the sender's number.
    expect(sent.every((m) => m.to === "27820000001")).toBe(true);
  });

  it("handles each message once even when two workers run together", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("Hi")],
      whatsapp_conversations: [],
      consent_records: [],
      check_ins: [],
    });
    const { provider, sent } = fakeProvider();
    const env = { admin: db.admin, provider, secrets: SECRETS, now: NOW };
    const [a, b] = await Promise.all([processPendingInbound(env), processPendingInbound(env)]);
    expect(a.processed + b.processed).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("an unknown number gets one reply a day and nothing clinical is written", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [],
      whatsapp_conversations: [],
      consent_records: [],
      check_ins: [],
    });
    const { provider, sent } = fakeProvider();
    const env = { admin: db.admin, provider, secrets: SECRETS, now: NOW };
    db.tables.whatsapp_inbound.push(inbound("hello", undefined, "27839999999"));
    await processPendingInbound(env);
    db.tables.whatsapp_inbound.push(inbound("hello?", undefined, "27839999999"));
    await processPendingInbound(env);
    expect(sent).toHaveLength(1);
    expect(db.tables.whatsapp_conversations[0]).toMatchObject({
      client_id: null,
      state: "unmatched",
    });
    expect(db.tables.check_ins).toHaveLength(0);
    expect(db.tables.consent_records).toHaveLength(0);
  });

  it("links an unknown number as soon as the practitioner adds it to the profile", async () => {
    const db = fakeDb({
      clients: [{ ...CLIENT, phone: null }],
      whatsapp_inbound: [inbound("hi")],
      whatsapp_conversations: [],
      consent_records: [],
      check_ins: [],
    });
    const { provider } = fakeProvider();
    const env = { admin: db.admin, provider, secrets: SECRETS, now: NOW };
    await processPendingInbound(env);
    expect(db.tables.whatsapp_conversations[0].state).toBe("unmatched");
    db.tables.clients[0].phone = "+27 82 000 0001";
    db.tables.whatsapp_inbound.push(inbound("hi again"));
    await processPendingInbound(env);
    expect(db.tables.whatsapp_conversations[0]).toMatchObject({
      client_id: "client-1",
      state: "awaiting_consent",
    });
  });

  it("STOP withdraws consent and stops the check-ins", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("STOP")],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "awaiting_pain",
          draft: {},
          checkin_started_at: NOW().toISOString(),
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [],
    });
    const { provider } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    expect(db.tables.whatsapp_conversations[0].state).toBe("opted_out");
    expect(db.tables.whatsapp_conversations[0].opted_out_at).toBeTruthy();
    expect(db.tables.consent_records[0].withdrawn_at).toBeTruthy();
  });

  it("a red flag raises an alert on the profile and the patient gets the safety message", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("my calf is swollen and hot and red")],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "idle",
          draft: {},
          checkin_started_at: null,
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [],
      alerts: [],
    });
    const { provider, sent } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    const alert = db.tables.alerts.find((a) => a.alert_type === "red_flag");
    expect(alert).toBeTruthy();
    expect(alert).toMatchObject({ client_id: "client-1", practitioner_id: "prac-1" });
    expect((sent[0] as { body: string }).body).toMatch(/physiotherapist|10177/);
  });

  it("marks a message failed rather than losing it when the check-in cannot be written", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("Nothing", IDS.notesNone)],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "awaiting_notes",
          draft: { pain: 3, sleep: 3, energy: 3 },
          checkin_started_at: NOW().toISOString(),
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [],
    });
    const realFrom = db.admin.from;
    db.admin.from = (t: string) => {
      const b = realFrom(t);
      if (t === "check_ins") {
        const origInsert = b.insert;
        b.insert = () => ({
          then: (res: any) => Promise.resolve({ error: { code: "42501" } }).then(res),
        });
        void origInsert;
      }
      return b;
    };
    const { provider } = fakeProvider();
    const r = await processPendingInbound({
      admin: db.admin,
      provider,
      secrets: SECRETS,
      now: NOW,
    });
    expect(r.failed).toBe(1);
    expect(db.tables.whatsapp_inbound[0]).toMatchObject({ status: "failed" });
    expect(db.tables.whatsapp_inbound[0].failure_reason).toContain("42501");
  });

  it("releases a message abandoned mid-processing so the patient still gets an answer", async () => {
    const abandoned = {
      ...inbound("Hi"),
      status: "processing",
      processed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    const fresh = {
      ...inbound("Hi", undefined, "27820000002"),
      status: "processing",
      processed_at: new Date().toISOString(),
    };
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [abandoned, fresh],
      whatsapp_conversations: [],
      consent_records: [],
      check_ins: [],
    });
    const { provider, sent } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    expect(db.tables.whatsapp_inbound[0].status).toBe("processed");
    // A claim still within its window belongs to whoever holds it.
    expect(db.tables.whatsapp_inbound[1].status).toBe("processing");
    expect(sent).toHaveLength(1);
  });

  it("saves a requested check-in time to the same reminder row the app uses", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("remind me at 7am")],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "idle",
          draft: {},
          checkin_started_at: null,
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [],
    });
    const { provider } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    expect(db.tables.checkin_reminders[0]).toMatchObject({
      client_id: "client-1",
      time_of_day: "07:00",
      enabled: true,
      timezone: "Africa/Johannesburg",
    });
  });

  it("does not offer a wearable to someone who already has one connected", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("Nothing", IDS.notesNone)],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "awaiting_notes",
          draft: { pain: 2, sleep: 4, energy: 4 },
          checkin_started_at: NOW().toISOString(),
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [],
      wearable_tokens: [{ client_id: "client-1", provider: "garmin" }],
    });
    const { provider, sent } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    expect(sent).toHaveLength(1);
    expect(db.tables.whatsapp_conversations[0].state).toBe("idle");
  });

  it("a clinical question raises an alert waiting for Justin and promises an answer", async () => {
    const db = fakeDb({
      clients: [CLIENT],
      whatsapp_inbound: [inbound("Should I ice it?")],
      whatsapp_conversations: [
        {
          id: "c1",
          phone: "27820000001",
          client_id: "client-1",
          state: "idle",
          draft: {},
          checkin_started_at: null,
        },
      ],
      consent_records: [
        {
          id: "k1",
          client_id: "client-1",
          consent_type: "whatsapp_checkins",
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
      check_ins: [
        { id: "x", client_id: "client-1", created_at: "2026-10-05T06:00:00Z", pain_level: 3 },
      ],
      alerts: [],
    });
    const { provider, sent } = fakeProvider();
    await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
    expect((sent[0] as { body: string }).body).toMatch(/not medically equipped/);
    expect(db.tables.alerts[0]).toMatchObject({
      client_id: "client-1",
      alert_type: "client_contact_request",
      urgency: "soon",
    });
    expect(db.tables.alerts[0].message).toContain("Should I ice it?");
  });

  it("hands an unplaced message to the conversational model, with recent history, and acts on its choice", async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const calls: Array<{ system: string; content: string }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}");
      const tool = body.tools?.[0]?.name;
      calls.push({ system: body.system, content: body.messages?.[0]?.content ?? "" });
      const input =
        tool === "route_message"
          ? { intent: "other", answer: null }
          : {
              reply: "Thanks for telling me, I'll let your physio know.",
              action: "note_for_practitioner",
              time: null,
            };
      return new Response(JSON.stringify({ content: [{ type: "tool_use", input }] }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const db = fakeDb({
        clients: [{ ...CLIENT, yves_ai_consent: true }],
        whatsapp_inbound: [inbound("glute still feels like a rock lol")],
        whatsapp_outbound: [
          {
            phone: "27820000001",
            body: "Thanks, that's saved.",
            created_at: "2026-10-05T06:00:00Z",
          },
        ],
        whatsapp_conversations: [
          {
            id: "c1",
            phone: "27820000001",
            client_id: "client-1",
            state: "idle",
            draft: {},
            checkin_started_at: null,
          },
        ],
        consent_records: [
          {
            id: "k1",
            client_id: "client-1",
            consent_type: "whatsapp_checkins",
            withdrawn_at: null,
            superseded_by: null,
          },
        ],
        check_ins: [
          { id: "x", client_id: "client-1", created_at: "2026-10-05T06:00:00Z", pain_level: 3 },
        ],
        alerts: [],
      });
      const { provider, sent } = fakeProvider();
      await processPendingInbound({ admin: db.admin, provider, secrets: SECRETS, now: NOW });
      expect((sent[0] as { body: string }).body).toBe(
        "Thanks for telling me, I'll let your physio know.",
      );
      expect(db.tables.alerts[0].message).toContain("glute still feels like a rock lol");
      const converseCall = calls.find((c) => c.system?.includes("You are Buddy"));
      expect(converseCall?.content).toContain("Buddy: Thanks, that's saved.");
      expect(converseCall?.system).toContain("already done today's check-in");
    } finally {
      globalThis.fetch = realFetch;
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});
