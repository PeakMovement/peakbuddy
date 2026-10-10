import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import { handlePractitionerMessage } from "./practitioner-mode.server";
import {
  bucketOf,
  formatStatusAll,
  formatStatusOne,
  practitionerIntent,
  readTime,
  runPractitionerJobs,
  sayClock,
  updateDue,
  type ClientStatus,
} from "./practitioner-status.server";

// 9 Oct 2026, 12:00 SAST (a Friday).
const NOW = new Date("2026-10-09T10:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const SAM = "11111111-1111-1111-1111-111111111111";
const LEE = "33333333-3333-3333-3333-333333333333";

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
      gte: (k: string, v: string) => (f.push((r) => r[k] >= v), api),
      gt: (k: string, v: string) => (f.push((r) => r[k] > v), api),
      order: () => api,
      limit: () => (patch ? api : Promise.resolve(done())),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      update: (p: Row) => ((patch = p), api),
      upsert: (r: Row) => ((upsertRow = r), api),
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
        listUsers: async () => ({ data: { users: [{ id: "zoe", phone: "27692047284" }] } }),
        getUserById: async (id: string) => ({
          data: { user: id === "zoe" ? { id, phone: "27692047284" } : null },
        }),
      },
    },
  } as any;
}

function world() {
  return fakeDb({
    practices: [{ id: "pm", practitioner_id: "justin" }],
    practice_members: [{ user_id: "zoe", practice_id: "pm", status: "active", role: "member" }],
    profiles: [{ id: "zoe", full_name: "Zoe Bredenkamp" }],
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
        auth_user_id: "u-lee",
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        full_name: "Ann Old",
        practitioner_id: "zoe",
        practice_id: "pm",
        created_at: daysAgo(200),
        auth_user_id: null,
      },
    ],
    check_ins: [
      {
        client_id: SAM,
        pain_level: 7,
        sleep_quality: 2,
        energy_level: 3,
        notes: "knee swollen after run",
        created_at: daysAgo(1),
      },
      {
        client_id: SAM,
        pain_level: 4,
        sleep_quality: 3,
        energy_level: 3,
        notes: null,
        created_at: daysAgo(3),
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
    alerts: [],
    whatsapp_conversations: [
      { id: "c1", client_id: SAM, phone: "27820000001", opted_out_at: null, state: "idle" },
    ],
    whatsapp_inbound: [{ from_phone: "27692047284", received_at: daysAgo(0.1) }],
    whatsapp_outbound: [],
  });
}

function deps(extra: Partial<any> = {}) {
  const replies: any[] = [];
  return {
    replies,
    d: {
      provider: { id: "meta", send: vi.fn(async () => ({ providerMessageId: "w1" })) } as any,
      secrets: {} as any,
      now: NOW,
      reply: async (m: any) => void replies.push(m),
      ...extra,
    },
  };
}
const PRAC = { userId: "zoe", firstName: "Zoe" };

describe("practitioner intents", () => {
  it.each([
    ["How are my clients doing?", "status_all"],
    ["how's my patients", "status_all"],
    ["client update", "status_all"],
    ["status", "status_all"],
    ["How is Sam Kruger doing?", "status_one"],
    ["how's Sam getting on", "status_one"],
    ["Check in with Sam", "checkin"],
    ["Can you ask Sam Kruger to check in", "checkin"],
    ["Update me daily", "updates"],
    ["send me a weekly report", "updates"],
    ["stop the updates", "updates"],
    ["I've sent Sam his programme", "other"],
    ["hello", "other"],
  ])("%s -> %s", (text, kind) => {
    expect(practitionerIntent(text, null).kind).toBe(kind);
  });

  it("reads frequency, day and time", () => {
    expect(practitionerIntent("update me every Friday at 6pm", null)).toMatchObject({
      kind: "updates",
      frequency: "weekly",
      weekday: 5,
      time: "18:00",
    });
    expect(practitionerIntent("update me every weekday at 7", null)).toMatchObject({
      frequency: "weekdays",
      time: "07:00",
    });
    expect(practitionerIntent("stop sending me updates", null)).toMatchObject({ frequency: "off" });
    expect(readTime("daily at 7:30am")).toBe("07:30");
    expect(readTime("daily")).toBe("07:30");
    expect(sayClock("18:00")).toBe("6pm");
    expect(sayClock("07:30")).toBe("7:30am");
  });

  it("button ids", () => {
    expect(practitionerIntent("", "prac_status").kind).toBe("status_all");
    expect(practitionerIntent("", `prac_ci_${SAM}`)).toEqual({ kind: "checkin", clientId: SAM });
    expect(practitionerIntent("", "prac_upd_off")).toMatchObject({ frequency: "off" });
  });
});

describe("updateDue", () => {
  const base = { frequency: "daily", weekday: 1, send_time: "07:30", last_sent_at: null };
  it("daily after the time, once a day", () => {
    expect(updateDue(base, NOW)).toBe(true);
    expect(updateDue({ ...base, last_sent_at: daysAgo(0.05) }, NOW)).toBe(false);
    expect(updateDue({ ...base, last_sent_at: daysAgo(1) }, NOW)).toBe(true);
    expect(updateDue({ ...base, send_time: "13:00" }, NOW)).toBe(false);
  });
  it("weekly on its day only, never when off", () => {
    expect(updateDue({ ...base, frequency: "weekly", weekday: 5 }, NOW)).toBe(true);
    expect(updateDue({ ...base, frequency: "weekly", weekday: 1 }, NOW)).toBe(false);
    expect(updateDue({ ...base, frequency: "off" }, NOW)).toBe(false);
  });
});

describe("status", () => {
  const mk = (over: Partial<ClientStatus>): ClientStatus => ({
    id: "x",
    name: "X",
    joinedAt: daysAgo(30),
    checkins: [],
    openAlerts: [],
    channel: "whatsapp",
    ...over,
  });
  it("buckets", () => {
    expect(
      bucketOf(
        mk({ checkins: [{ at: daysAgo(1), pain: 7, sleep: null, energy: null, notes: null }] }),
        NOW,
      ),
    ).toBe("attention");
    expect(
      bucketOf(
        mk({
          checkins: [
            { at: daysAgo(1), pain: 5, sleep: null, energy: null, notes: null },
            { at: daysAgo(2), pain: 3, sleep: null, energy: null, notes: null },
          ],
        }),
        NOW,
      ),
    ).toBe("attention");
    expect(
      bucketOf(
        mk({ checkins: [{ at: daysAgo(6), pain: 2, sleep: null, energy: null, notes: null }] }),
        NOW,
      ),
    ).toBe("quiet");
    expect(
      bucketOf(
        mk({ checkins: [{ at: daysAgo(1), pain: 2, sleep: null, energy: null, notes: null }] }),
        NOW,
      ),
    ).toBe("well");
    expect(bucketOf(mk({ joinedAt: daysAgo(200) }), NOW)).toBe("inactive");
    expect(
      bucketOf(mk({ openAlerts: [{ type: "red_flag", urgency: "urgent", at: daysAgo(1) }] }), NOW),
    ).toBe("attention");
  });

  it("formats all and one", () => {
    const sam = mk({
      name: "Sam Kruger",
      checkins: [
        { at: daysAgo(1), pain: 7, sleep: 2, energy: 3, notes: "knee swollen" },
        { at: daysAgo(3), pain: 4, sleep: 3, energy: 3, notes: null },
      ],
    });
    const all = formatStatusAll("Zoe", [sam, mk({ name: "Old", joinedAt: daysAgo(200) })], NOW);
    expect(all).toContain("(1 current)");
    expect(all).toContain("Sam Kruger: pain 7, up from 4, yesterday");
    expect(all).not.toContain("Old");
    const one = formatStatusOne(sam, NOW);
    expect(one).toContain("pain 7/10, sleep 2/5, energy 3/5");
    expect(one).toContain("pain 4 to 7 (worse)");
    expect(one).toContain('"knee swollen"');
  });
});

describe("practitioner conversation", () => {
  it("how are my clients", async () => {
    const db = world();
    const { replies, d } = deps();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "How are my clients doing?", replyId: null },
      d,
    );
    const body = replies[0].body as string;
    expect(body).toContain("Here's how your clients are doing, Zoe (2 current)");
    expect(body).toContain("Needs a look (1)");
    expect(body).toContain("Sam Kruger");
    expect(body).toContain("Gone quiet (1)");
    expect(body).toContain("Lee Adams: last check-in 6 days ago");
    expect(body).not.toContain("Ann Old");
  });

  it("how is one client, with a check-in button", async () => {
    const db = world();
    const { replies, d } = deps();
    await handlePractitionerMessage(db, PRAC, { text: "How is Sam doing?", replyId: null }, d);
    expect(replies[0].kind).toBe("buttons");
    expect(replies[0].body).toContain("*Sam Kruger*");
    expect(replies[0].buttons[0].id).toBe(`prac_ci_${SAM}`);
  });

  it("saves update preferences", async () => {
    const db = world();
    const { replies, d } = deps();
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "Update me every Monday at 8am", replyId: null },
      d,
    );
    expect(replies[0].body).toBe("Done. I'll send you a client update every Monday at 8am.");
    expect(db.t.practitioner_update_prefs[0]).toMatchObject({
      practitioner_id: "zoe",
      frequency: "weekly",
      weekday: 1,
      send_time: "08:00",
    });
  });

  it("check in with a WhatsApp client, then passes the answers back", async () => {
    const db = world();
    const requestCheckin = vi.fn(async () => "sent" as const);
    const { replies, d } = deps({ requestCheckin });
    await handlePractitionerMessage(
      db,
      PRAC,
      { text: "Check in with Sam Kruger", replyId: null },
      d,
    );
    expect(requestCheckin).toHaveBeenCalledWith(SAM);
    expect(replies[0].body).toBe(
      "Done, I've asked Sam to check in. I'll send you their answers when they reply.",
    );
    const req = db.t.practitioner_checkin_requests[0];
    expect(req).toMatchObject({ client_id: SAM, practitioner_id: "zoe" });

    // Sam checks in later; the minute job tells Zoe.
    db.t.check_ins.push({
      client_id: SAM,
      pain_level: 5,
      sleep_quality: 3,
      energy_level: 3,
      notes: null,
      created_at: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    const send = vi.fn(async () => ({ providerMessageId: "w2" }));
    await runPractitionerJobs(
      db,
      { provider: { id: "meta", send } as any, secrets: {} as any },
      new Date(NOW.getTime() + 120_000),
    );
    expect(send).toHaveBeenCalledTimes(1);
    const msg = (send.mock.calls[0] as any[])[0];
    expect(msg.to).toBe("27692047284");
    expect(msg.body).toContain("Sam just did the check-in you asked for.");
    expect(msg.body).toContain("pain 5/10");
    expect(req.notified_at).toBeTruthy();
  });

  it("app-only client gets a push instead", async () => {
    const db = world();
    push.mockClear();
    const { replies, d } = deps({ requestCheckin: async () => "not_whatsapp" as const });
    await handlePractitionerMessage(db, PRAC, { text: "check in with Lee", replyId: null }, d);
    expect(push).toHaveBeenCalledTimes(1);
    expect(replies[0].body).toContain("Lee uses the Buddy app");
  });

  it("help lists everything, with buttons", async () => {
    const db = world();
    const { replies, d } = deps();
    await handlePractitionerMessage(db, PRAC, { text: "hi", replyId: null }, d);
    expect(replies[0].kind).toBe("buttons");
    expect(replies[0].body).toContain("How are my clients doing?");
    expect(replies[0].buttons.map((b: any) => b.id)).toEqual(["prac_status", "prac_updates"]);
  });

  it("scheduled update goes out once, inside the window", async () => {
    const db = world();
    db.t.practitioner_update_prefs = [
      {
        practitioner_id: "zoe",
        frequency: "daily",
        weekday: 1,
        send_time: "07:30",
        last_sent_at: null,
      },
    ];
    const send = vi.fn(async () => ({ providerMessageId: "w3" }));
    const env = { provider: { id: "meta", send } as any, secrets: {} as any };
    await runPractitionerJobs(db, env, NOW);
    await runPractitionerJobs(db, env, new Date(NOW.getTime() + 60_000));
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any[])[0].body).toContain(
      "Here's how your clients are doing, Zoe",
    );
  });

  it("tells the practitioner by name when a client stops Buddy", async () => {
    const db = world();
    push.mockClear();
    db.t.alerts.push({
      id: "al1",
      practitioner_id: "zoe",
      client_id: SAM,
      alert_type: "whatsapp_opt_out",
      message: "Sam Kruger asked Buddy to stop their WhatsApp check-ins.",
      push_fired: false,
      created_at: daysAgo(0.01),
    });
    const send = vi.fn(async () => ({ providerMessageId: "w4" }));
    const env = { provider: { id: "meta", send } as any, secrets: {} as any };
    await runPractitionerJobs(db, env, NOW);
    await runPractitionerJobs(db, env, NOW);
    expect(push).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any[])[0].body).toContain("Sam Kruger asked Buddy to stop");
    expect(db.t.alerts[0].push_fired).toBe(true);
  });
});
