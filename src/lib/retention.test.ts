import { describe, expect, it } from "vitest";
import { CLINICAL_RECORD_RETENTION } from "@/lib/consent/wording";
import {
  deleteWhatsAppForPatient,
  phoneKeys,
  RETENTION_RULE,
  runWhatsAppRetention,
} from "@/lib/retention.server";

type Row = Record<string, unknown>;

function fakeAdmin(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));

  function builder(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "delete" = "select";
    const api = {
      delete() {
        op = "delete";
        return api;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return api;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return api;
      },
      lt(c: string, v: unknown) {
        filters.push((r) => r[c] != null && (r[c] as string) < (v as string));
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "delete") {
          const drop = new Set(matched);
          tables[table] = rows().filter((r) => !drop.has(r));
        }
        return Promise.resolve({ data: matched, error: null, count: matched.length }).then(
          resolve,
          reject,
        );
      },
    };
    return api;
  }

  return { tables, admin: { from: (t: string) => builder(t) } };
}

const OLD = "2026-10-01T00:00:00Z";
const FRESH = "2026-10-10T12:00:00Z";
const NOW = new Date("2026-10-10T13:00:00Z");

describe("WhatsApp retention", () => {
  it("uses the same sentence as the current consent", () => {
    expect(RETENTION_RULE).toBe(CLINICAL_RECORD_RETENTION);
    expect(RETENTION_RULE).not.toMatch(/90 days/);
  });

  it("deletes only orphaned rows older than a day, and keeps a sign-up in progress", async () => {
    const db = fakeAdmin({
      whatsapp_inbound: [
        { id: "old-orphan", client_id: null, received_at: OLD },
        { id: "fresh-orphan", client_id: null, received_at: FRESH },
        { id: "kept", client_id: "client-1", received_at: OLD },
      ],
      whatsapp_outbound: [
        { id: "old-orphan", client_id: null, created_at: OLD },
        { id: "kept", client_id: "client-1", created_at: OLD },
      ],
      whatsapp_conversations: [
        { id: "old-unmatched", client_id: null, state: "unmatched", updated_at: OLD },
        { id: "signing-up", client_id: null, state: "awaiting_name", updated_at: OLD },
        { id: "kept", client_id: "client-1", state: "idle", updated_at: OLD },
      ],
    });
    const result = await runWhatsAppRetention(db.admin as never, NOW);
    expect(result).toEqual({ inbound: 1, outbound: 1, conversations: 1 });
    expect(db.tables.whatsapp_inbound.map((r) => r.id)).toEqual(["fresh-orphan", "kept"]);
    expect(db.tables.whatsapp_outbound.map((r) => r.id)).toEqual(["kept"]);
    expect(db.tables.whatsapp_conversations.map((r) => r.id)).toEqual(["signing-up", "kept"]);
  });

  it("removes WhatsApp rows for a deleted account by profile and by phone", async () => {
    const db = fakeAdmin({
      whatsapp_inbound: [
        { id: "by-client", client_id: "client-1", from_phone: "+27820000001" },
        { id: "by-phone", client_id: null, from_phone: "27820000001" },
        { id: "other", client_id: "client-2", from_phone: "+27820000002" },
      ],
      whatsapp_outbound: [{ id: "by-client", client_id: "client-1", phone: "+27820000001" }],
      whatsapp_conversations: [{ id: "by-phone", client_id: null, phone: "27820000001" }],
    });
    expect(phoneKeys("082 000 0001")).toEqual(expect.arrayContaining(["27820000001", "+27820000001"]));
    await deleteWhatsAppForPatient(db.admin as never, { id: "client-1", phone: "082 000 0001" });
    expect(db.tables.whatsapp_inbound.map((r) => r.id)).toEqual(["other"]);
    expect(db.tables.whatsapp_outbound).toHaveLength(0);
    expect(db.tables.whatsapp_conversations).toHaveLength(0);
  });
});
