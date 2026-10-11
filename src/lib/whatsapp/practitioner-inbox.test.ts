import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: vi.fn(async () => ({})) }));

import { handlePractitionerMessage } from "./practitioner-mode.server";
import { practitionerIntent } from "./practitioner-status.server";
import { cleanAlertText, readCheckedIn, wantsMessages } from "./practitioner-inbox-text";

// Sunday 11 Oct 2026, 12:00 SAST. Monday was 5 Oct.
const NOW = new Date("2026-10-11T10:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const LAUREN = "11111111-1111-1111-1111-111111111111";
const NICOLA = "22222222-2222-2222-2222-222222222222";
const TAYLA = "33333333-3333-3333-3333-333333333333";
const CAYLA = "44444444-4444-4444-4444-444444444444";
const A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const A3 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

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
      neq: (k: string, v: unknown) => (f.push((r) => r[k] !== v), api),
      in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), api),
      is: (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), api),
      gte: (k: string, v: string) => (f.push((r) => r[k] >= v), api),
      gt: (k: string, v: string) => (f.push((r) => r[k] > v), api),
      lt: (k: string, v: string) => (f.push((r) => r[k] < v), api),
      order: () => api,
      limit: () => (patch ? api : Promise.resolve(done())),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      update: (p: Row) => ((patch = p), api),
      insert: (r: Row) => ((t[table] ??= []).push(r), Promise.resolve({ error: null })),
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

function world() {
  const client = (id: string, full_name: string, created: number) => ({
    id,
    full_name,
    practitioner_id: "justin",
    practice_id: "pm",
    created_at: daysAgo(created),
    auth_user_id: null,
  });
  return fakeDb({
    practices: [{ id: "pm", practitioner_id: "justin", practice_name: "Peak Movement" }],
    practice_members: [],
    profiles: [{ id: "justin", full_name: "Justin Muller", role: "super_admin" }],
    clients: [
      client(LAUREN, "Lauren Ogg", 20),
      client(NICOLA, "Nicola Stockdale", 20),
      client(TAYLA, "Tayla Sasha Faulmann", 20),
      client(CAYLA, "Cayla Rosenblatt", 40),
    ],
    check_ins: [
      {
        client_id: TAYLA,
        pain_level: 1,
        sleep_quality: 4,
        energy_level: 4,
        notes: null,
        created_at: daysAgo(0.05),
      },
      {
        client_id: NICOLA,
        pain_level: 10,
        sleep_quality: 1,
        energy_level: 1,
        notes: null,
        created_at: daysAgo(2),
      },
      {
        client_id: NICOLA,
        pain_level: 8,
        sleep_quality: 2,
        energy_level: 2,
        notes: null,
        created_at: daysAgo(3),
      },
      {
        client_id: CAYLA,
        pain_level: 3,
        sleep_quality: 3,
        energy_level: 3,
        notes: null,
        created_at: daysAgo(18),
      },
    ],
    alerts: [
      {
        id: A1,
        client_id: LAUREN,
        alert_type: "client_contact_request",
        urgency: "soon",
        created_at: daysAgo(1),
        message: "Message from client: synthetic test, can I move my session to Thursday?",
        is_read: false,
        reviewed_at: null,
      },
      {
        id: A2,
        client_id: NICOLA,
        alert_type: "red_flag",
        urgency: "urgent",
        created_at: daysAgo(2),
        message: "WhatsApp check-in: Pain reported at 10/10",
        is_read: false,
        reviewed_at: null,
      },
      {
        id: A3,
        client_id: NICOLA,
        alert_type: "client_contact_request",
        urgency: "soon",
        created_at: daysAgo(2.1),
        message: "Clinical question on WhatsApp: synthetic test question",
        is_read: false,
        reviewed_at: null,
      },
    ],
    whatsapp_conversations: [],
  });
}

const JUSTIN = { userId: "justin", firstName: "Justin" };
function harness() {
  const db = world();
  const replies: any[] = [];
  const mem = {};
  const say = (text: string, replyId: string | null = null) =>
    handlePractitionerMessage(
      db,
      JUSTIN,
      { text, replyId },
      {
        provider: { id: "meta", send: vi.fn(async () => ({ providerMessageId: "w" })) } as any,
        secrets: {} as any,
        now: NOW,
        reply: async (m: any) => void replies.push(m),
      },
      mem,
    );
  return { db, replies, say };
}

describe("reading the new phrases", () => {
  it.each([
    ["Let's see who has checked in this week ?", "checked_in"],
    ["who checked in today", "checked_in"],
    ["Who has checked in since Monday?", "checked_in"],
    ["Let's see Lauren's message", "messages"],
    ["show me Nicola's alerts", "messages"],
    ["what did Lauren say?", "messages"],
    ["my messages", "messages"],
    ["what's waiting for me", "messages"],
    ["who hasn't checked in", "admin"],
    ["any red flags?", "admin"],
    ["How are my clients", "status_all"],
  ])("%s -> %s", (text, kind) => {
    expect(practitionerIntent(text, null).kind).toBe(kind);
  });

  it("ranges", () => {
    expect(readCheckedIn("who checked in this week", NOW)?.label).toBe("this week");
    expect(readCheckedIn("who checked in this week", NOW)?.since).toBe(
      Date.parse("2026-10-05T00:00:00+02:00"),
    );
    expect(readCheckedIn("who checked in today", NOW)?.since).toBe(
      Date.parse("2026-10-11T00:00:00+02:00"),
    );
    expect(readCheckedIn("who checked in yesterday", NOW)?.label).toBe("yesterday");
    expect(readCheckedIn("who checked in since Friday", NOW)?.since).toBe(
      Date.parse("2026-10-09T00:00:00+02:00"),
    );
    expect(readCheckedIn("who checked in in the last 3 days", NOW)?.label).toBe(
      "in the last 3 days",
    );
    expect(readCheckedIn("who hasn't checked in", NOW)).toBeNull();
    expect(wantsMessages("I've sent Sam his programme")).toBe(false);
  });

  it("cleans alert text", () => {
    expect(cleanAlertText("WhatsApp check-in: Pain reported at 10/10")).toBe(
      "Pain reported at 10/10",
    );
    expect(cleanAlertText("a\n\nb   c")).toBe("a b c");
    expect(cleanAlertText(null)).toBe("(no details saved)");
  });
});

describe("Justin's chat from 11 Oct, replayed", () => {
  it("who has checked in this week", async () => {
    const { replies, say } = harness();
    await say("Let's see who has checked in this week ?");
    const body = replies[0].body as string;
    expect(body).toContain("Checked in this week (2 of 4)");
    expect(body).toContain("Tayla Sasha Faulmann: today, pain 1");
    expect(body).toContain("Nicola Stockdale: 2 days ago, pain 10 (2 check-ins)");
    expect(body).toContain("Not yet: Lauren Ogg, Cayla Rosenblatt.");
  });

  it("Let's see Lauren's message: the message in full, with Mark reviewed", async () => {
    const { replies, say } = harness();
    await say("Let's see Lauren's message");
    expect(replies[0].kind).toBe("buttons");
    expect(replies[0].body).toContain("*Lauren Ogg: 1 open*");
    expect(replies[0].body).toContain("1. Message, yesterday");
    expect(replies[0].body).toContain("can I move my session to Thursday?");
    expect(replies[0].buttons.map((b: any) => b.id)).toEqual([
      `prac_rev_${A1}`,
      `prac_ci_${LAUREN}`,
      `prac_one_${LAUREN}`,
    ]);
  });

  it("a bare name, or a typo of it, brings up the client with open items in full", async () => {
    for (const text of ["Lauren Ogg", "Lauren off", "lauren"]) {
      const { replies, say } = harness();
      await say(text);
      expect(replies[0].kind).toBe("buttons");
      expect(replies[0].body).toContain("*Lauren Ogg*");
      expect(replies[0].body).toContain("*Open (1)*");
      expect(replies[0].body).toContain("can I move my session to Thursday?");
      expect(replies[0].body).not.toContain("Open their profile");
      expect(replies[0].buttons.map((b: any) => b.title)).toEqual([
        "Read in full",
        "Mark reviewed",
        "Ask for a check-in",
      ]);
    }
  });

  it("a longer message that only mentions a client asks first", async () => {
    const { replies, say } = harness();
    await say("I was thinking about Lauren this morning");
    expect(replies[0].body).toBe("Did you mean: how is Lauren Ogg doing?");
  });

  it("mark reviewed from WhatsApp, one and all", async () => {
    const { db, replies, say } = harness();
    await say("", `prac_rev_${A1}`);
    expect(replies[0].body).toBe(
      "Done, marked as reviewed for Lauren Ogg. Nothing else open for Lauren Ogg.",
    );
    expect(db.t.alerts.find((a: Row) => a.id === A1)).toMatchObject({
      is_read: true,
      reviewed_by: "justin",
    });
    await say("show Nicola's messages");
    expect(replies[1].body).toContain("*Nicola Stockdale: 2 open*");
    expect(replies[1].body).toContain("Red flag (urgent), 2 days ago");
    expect(replies[1].body).toContain("Pain reported at 10/10");
    expect(replies[1].buttons[0]).toEqual({
      id: `prac_revall_${NICOLA}`,
      title: "Mark all reviewed",
    });
    await say("", `prac_revall_${NICOLA}`);
    expect(replies[2].body).toBe(
      "Done, marked 2 as reviewed for Nicola Stockdale. Nothing else open for Nicola Stockdale.",
    );
  });

  it("my messages: everything waiting", async () => {
    const { replies, say } = harness();
    await say("my messages");
    const body = replies[0].body as string;
    expect(body).toContain("3 open items for 2 clients");
    expect(body).toContain("*Lauren Ogg* (1)");
    expect(body).toContain("*Nicola Stockdale* (2)");
  });

  it("someone else's alert can't be marked reviewed", async () => {
    const { db, replies, say } = harness();
    db.t.clients.find((c: Row) => c.id === LAUREN).practitioner_id = "zoe";
    db.t.clients.find((c: Row) => c.id === LAUREN).practice_id = "other";
    await say("", `prac_rev_${A1}`);
    expect(replies[0].body).toContain("couldn't find");
    expect(db.t.alerts.find((a: Row) => a.id === A1).is_read).toBe(false);
  });

  it("still says it didn't get it when there's no name and no command", async () => {
    const { replies, say } = harness();
    await say("blue elephant");
    expect(replies[0].body).toContain("what should I do?");
    expect(replies[0].body).toContain("who checked in this week?");
  });
});
