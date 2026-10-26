import { afterEach, describe, expect, it } from "vitest";
import { currentConsent } from "@/lib/consent/wording";
import { runProgrammeReminders } from "./programme-reminder.server";

const NOW = new Date("2026-10-26T08:00:00Z");
const CLIENT = "11111111-1111-1111-1111-111111111111";

type Row = Record<string, unknown>;

function consent(clientId: string) {
  return (["popia_core", "whatsapp_checkins"] as const).map((t) => ({
    client_id: clientId,
    consent_type: t,
    version: currentConsent(t).version,
    withdrawn_at: null,
    superseded_by: null,
  }));
}

function fakeDb(tables: Record<string, Row[]>) {
  const sent: Array<{ to?: string; kind?: string; body?: string }> = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    const api = {
      select: () => api,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
      is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), api),
      in: (k: string, v: unknown[]) => (filters.push((r) => (v as unknown[]).includes(r[k])), api),
      order: () => api,
      limit: () => api,
      update: (p: Row) => ((patch = p), api),
      insert: (r: Row) => (rows().push(r), api),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (patch) for (const r of matched) Object.assign(r, patch);
        return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  const env = {
    provider: {
      id: "meta",
      send: async (m: { to?: string; kind?: string; body?: string }) => {
        sent.push(m);
        return { providerMessageId: "m1" };
      },
    },
    secrets: {},
  };
  return { admin: { from } as never, env, sent, tables };
}

function seed(over: Partial<{ opted_out_at: string | null; state: string; consent: Row[] }> = {}) {
  return fakeDb({
    clients: [
      {
        id: CLIENT,
        full_name: "Sam Kruger",
        programme_reminder_opt_in: true,
        programme_reminder_days: [1],
        programme_reminder_last_sent_on: null,
        archived_at: null,
      },
    ],
    whatsapp_conversations: [
      {
        client_id: CLIENT,
        phone: "27820000001",
        opted_out_at: over.opted_out_at ?? null,
        state: over.state ?? "idle",
      },
    ],
    whatsapp_inbound: [{ from_phone: "+27820000001", received_at: "2026-10-26T07:00:00Z" }],
    whatsapp_outbound: [],
    consent_records: over.consent ?? consent(CLIENT),
  });
}

afterEach(() => {
  delete process.env.PROGRAMME_REMINDERS;
});

describe("programme reminders", () => {
  it("sends on an opted-in day only when both consents are current", async () => {
    process.env.PROGRAMME_REMINDERS = "1";
    const db = seed();
    await runProgrammeReminders(db.admin, db.env as never, NOW);
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0]).toMatchObject({ kind: "text", to: "27820000001" });
    expect(db.tables.clients[0].programme_reminder_last_sent_on).toBe("2026-10-26");
  });

  it("does not message someone who replied STOP", async () => {
    process.env.PROGRAMME_REMINDERS = "1";
    const db = seed({ opted_out_at: "2026-10-20T00:00:00Z", state: "opted_out" });
    await runProgrammeReminders(db.admin, db.env as never, NOW);
    expect(db.sent).toHaveLength(0);
    expect(db.tables.clients[0].programme_reminder_last_sent_on).toBeNull();
  });

  it("does not message when POPIA or WhatsApp consent is missing", async () => {
    process.env.PROGRAMME_REMINDERS = "1";
    const db = seed({
      consent: [
        {
          client_id: CLIENT,
          consent_type: "whatsapp_checkins",
          version: currentConsent("whatsapp_checkins").version,
          withdrawn_at: null,
          superseded_by: null,
        },
      ],
    });
    await runProgrammeReminders(db.admin, db.env as never, NOW);
    expect(db.sent).toHaveLength(0);
    expect(db.tables.clients[0].programme_reminder_last_sent_on).toBeNull();
  });

  it("does not stamp the day when the send fails", async () => {
    process.env.PROGRAMME_REMINDERS = "1";
    const db = seed();
    db.env.provider.send = async () => {
      throw new Error("down");
    };
    await runProgrammeReminders(db.admin, db.env as never, NOW);
    expect(db.tables.clients[0].programme_reminder_last_sent_on).toBeNull();
  });
});
