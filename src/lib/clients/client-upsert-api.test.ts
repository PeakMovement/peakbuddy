import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activePractitionerRoster,
  canonicalNotionPageId,
  CLIENT_UPSERT_SOURCE,
  handleClientUpsertRequest,
  sameFirstName,
  storeFromAdmin,
  upsertClient,
  type ClientStore,
  type ClientUpsertInput,
  type NewClientRow,
  type UpsertAdmin,
  type UpsertOutcome,
} from "./client-upsert-api.server";

const API_SECRET = "client-upsert-api-secret-value";
const PRAC = "11111111-1111-4111-8111-111111111111";
const PRAC_2 = "11111111-1111-4111-8111-111111111112";
const PRACTICE = "22222222-2222-4222-8222-222222222222";
const PRACTICE_2 = "22222222-2222-4222-8222-222222222223";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const CLIENT_2 = "33333333-3333-4333-8333-333333333334";
const PAGE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = new Date("2026-11-23T04:00:00Z");

const savedSecret = process.env.CLIENT_UPSERT_API_SECRET;
const savedWatch = process.env.WATCH_LINK_API_SECRET;
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CLIENT_UPSERT_API_SECRET;
  else process.env.CLIENT_UPSERT_API_SECRET = savedSecret;
  if (savedWatch === undefined) delete process.env.WATCH_LINK_API_SECRET;
  else process.env.WATCH_LINK_API_SECRET = savedWatch;
});

function input(over: Partial<ClientUpsertInput> = {}): ClientUpsertInput {
  return {
    name: "Sam Kruger",
    phoneDigits: "27820000001",
    practitionerFirstName: "Zoe",
    notionPageId: PAGE,
    source: CLIENT_UPSERT_SOURCE,
    unarchive: false,
    ...over,
  };
}

function store(over: Partial<ClientStore> = {}): ClientStore {
  return {
    roster: async () => ({
      people: [{ id: PRAC, fullName: "Zoe Naude", role: "practitioner" }],
      practices: [{ id: PRACTICE, ownerId: PRAC, approved: true }],
      members: [],
    }),
    phones: async () => ({ hits: [] }),
    notionOwner: async () => ({ ids: [] }),
    insert: async () => ({ id: CLIENT }),
    unarchive: async () => ({ ok: true as const }),
    ...over,
  };
}

const body = {
  name: "Sam Kruger",
  phone: "+27820000001",
  practitioner: "Zoe",
  notion_page_id: PAGE,
  source: CLIENT_UPSERT_SOURCE,
};

function post(payload: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("https://example.test/api/public/hooks/client-upsert", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(payload),
  });
}

function auth(secret = API_SECRET): Record<string, string> {
  return { authorization: `Bearer ${secret}` };
}

describe("client-upsert hook auth", () => {
  it("stays off when its own secret is unset, even if the watch-link secret is set", async () => {
    delete process.env.CLIENT_UPSERT_API_SECRET;
    process.env.WATCH_LINK_API_SECRET = "watch-link-secret";
    const upsert = vi.fn();
    const res = await handleClientUpsertRequest(post(body, auth("watch-link-secret")), { upsert });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret without calling the lookup", async () => {
    const upsert = vi.fn();
    const missing = await handleClientUpsertRequest(post(body), { secret: API_SECRET, upsert });
    const wrong = await handleClientUpsertRequest(post(body, auth("nope")), {
      secret: API_SECRET,
      upsert,
    });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toBe("Unauthorized");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("accepts the secret as a bearer token or the client-upsert header", async () => {
    const upsert = vi.fn(
      async (): Promise<UpsertOutcome> => ({ status: 200, client_id: CLIENT, created: true }),
    );
    const bearer = await handleClientUpsertRequest(post(body, auth()), {
      secret: API_SECRET,
      now: NOW,
      upsert,
    });
    const header = await handleClientUpsertRequest(
      post(body, { "x-client-upsert-secret": API_SECRET }),
      { secret: API_SECRET, now: NOW, requestBuckets: new Map(), upsert },
    );
    expect(bearer.status).toBe(200);
    expect(header.status).toBe(200);
    expect(await bearer.json()).toEqual({ client_id: CLIENT, created: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ phoneDigits: "27820000001", name: "Sam Kruger" }),
    );
  });

  it("does not accept the watch-link header name", async () => {
    const upsert = vi.fn();
    const res = await handleClientUpsertRequest(
      post(body, { "x-watch-link-secret": API_SECRET, authorization: "Bearer nope" }),
      { secret: API_SECRET, upsert },
    );
    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rate limits failed auth separately from accepted requests", async () => {
    const authMap = new Map<string, number[]>();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const res = await handleClientUpsertRequest(post(body, auth("nope")), {
        secret: API_SECRET,
        now: NOW,
        authBuckets: authMap,
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("client-upsert hook requests", () => {
  it("normalises a local South African number before lookup", async () => {
    const upsert = vi.fn(
      async (): Promise<UpsertOutcome> => ({ status: 200, client_id: CLIENT, created: false }),
    );
    const res = await handleClientUpsertRequest(post({ ...body, phone: "082 000 0001" }, auth()), {
      secret: API_SECRET,
      now: NOW,
      upsert,
    });
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ phoneDigits: "27820000001" }));
  });

  it("rejects a bad body without calling the lookup", async () => {
    const upsert = vi.fn();
    const cases = [
      { ...body, name: "A" },
      { ...body, phone: "+14155552671" },
      { ...body, phone: "whatsapp:+27820000001" },
      { ...body, practitioner: "Zoe Naude" },
      { ...body, source: "other-list" },
      { ...body, notion_page_id: "not-a-page" },
      { ...body, unarchive: "yes" },
      { ...body, email: "sam@example.com" },
    ];
    for (const payload of cases) {
      const res = await handleClientUpsertRequest(post(payload, auth()), {
        secret: API_SECRET,
        requestBuckets: new Map(),
        upsert,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    const broken = await handleClientUpsertRequest(post(null, auth(), "{"), {
      secret: API_SECRET,
      requestBuckets: new Map(),
      upsert,
    });
    expect(broken.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("canonicalises a Notion id written without dashes", async () => {
    const upsert = vi.fn(
      async (): Promise<UpsertOutcome> => ({ status: 200, client_id: CLIENT, created: true }),
    );
    const res = await handleClientUpsertRequest(
      post({ ...body, notion_page_id: "AAAAAAAABBBB4CCC8DDDEEEEEEEEEEEE" }, auth()),
      { secret: API_SECRET, now: NOW, upsert },
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ notionPageId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
    );
  });

  it("passes unarchive only when the body asks for it", async () => {
    const upsert = vi.fn(
      async (): Promise<UpsertOutcome> => ({ status: 200, client_id: CLIENT, created: false }),
    );
    await handleClientUpsertRequest(post({ ...body, unarchive: true }, auth()), {
      secret: API_SECRET,
      now: NOW,
      upsert,
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ unarchive: true }));
  });

  it("rate limits the secret overall, not per phone", async () => {
    const buckets = new Map<string, number[]>();
    const upsert = vi.fn(
      async (): Promise<UpsertOutcome> => ({ status: 200, client_id: CLIENT, created: true }),
    );
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const res = await handleClientUpsertRequest(
        post({ ...body, phone: `+278200000${String(i).padStart(2, "0")}` }, auth()),
        { secret: API_SECRET, now: NOW, requestBuckets: buckets, upsert },
      );
      last = res.status;
    }
    expect(last).toBe(429);
    expect(upsert).toHaveBeenCalledTimes(30);
  });

  it("does not put a thrown error or the secret into the response", async () => {
    const upsert = vi.fn(async () => {
      throw new Error(`failed with ${API_SECRET} and +27820000001`);
    });
    const res = await handleClientUpsertRequest(post(body, auth()), { secret: API_SECRET, upsert });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain(API_SECRET);
    expect(text).not.toContain("27820000001");
    expect(text).toContain("unavailable");
  });

  it("maps lookup outcomes onto the response codes", async () => {
    const cases: Array<[UpsertOutcome, number, Record<string, unknown>]> = [
      [{ status: 400, error: "unknown_practitioner" }, 400, { error: "unknown_practitioner" }],
      [{ status: 409, error: "duplicate" }, 409, { error: "duplicate" }],
      [{ status: 409, error: "archived" }, 409, { error: "archived" }],
      [{ status: 503 }, 503, { error: "unavailable" }],
    ];
    for (const [outcome, status, json] of cases) {
      const res = await handleClientUpsertRequest(post(body, auth()), {
        secret: API_SECRET,
        now: NOW,
        requestBuckets: new Map(),
        upsert: async () => outcome,
      });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(json);
    }
  });
});

describe("upsertClient", () => {
  it("creates an unconsented client and does not write clinical fields", async () => {
    const inserted: NewClientRow[] = [];
    const result = await upsertClient(
      input(),
      store({
        insert: async (row) => {
          inserted.push(row);
          return { id: CLIENT };
        },
      }),
      () => "4321",
    );
    expect(result).toEqual({ status: 200, client_id: CLIENT, created: true });
    expect(inserted).toEqual([
      {
        practitioner_id: PRAC,
        practice_id: PRACTICE,
        full_name: "Sam Kruger",
        phone: "+27820000001",
        phone_e164: "27820000001",
        popia_accepted: false,
        yves_ai_consent: false,
        login_code: "4321",
        timezone: "Africa/Johannesburg",
        check_in_frequency: "daily",
        notes: "",
        program_status: "none",
        onboarding_source: CLIENT_UPSERT_SOURCE,
        source: CLIENT_UPSERT_SOURCE,
        notion_page_id: PAGE,
      },
    ]);
    expect(inserted[0]).not.toHaveProperty("email");
    expect(inserted[0]).not.toHaveProperty("auth_user_id");
    expect(inserted[0]).not.toHaveProperty("primary_complaint");
    expect(inserted[0]).not.toHaveProperty("popia_accepted_at");
    expect(inserted[0]).not.toHaveProperty("yves_ai_consent_at");
  });

  it("returns an existing active client and does not insert or unarchive", async () => {
    const insert = vi.fn();
    const unarchive = vi.fn();
    const result = await upsertClient(
      input({ name: "Different Name", practitionerFirstName: "Zoe" }),
      store({
        phones: async () => ({
          hits: [
            { id: CLIENT, archived: false },
            { id: CLIENT_2, archived: true },
          ],
        }),
        insert,
        unarchive,
      }),
    );
    expect(result).toEqual({ status: 200, client_id: CLIENT, created: false });
    expect(insert).not.toHaveBeenCalled();
    expect(unarchive).not.toHaveBeenCalled();
  });

  it("refuses two active profiles on the same number", async () => {
    const insert = vi.fn();
    const result = await upsertClient(
      input(),
      store({
        phones: async () => ({
          hits: [
            { id: CLIENT, archived: false },
            { id: CLIENT_2, archived: false },
          ],
        }),
        insert,
      }),
    );
    expect(result).toEqual({ status: 409, error: "duplicate" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not unarchive unless the body asks, and then only unarchives", async () => {
    const unarchive = vi.fn(async () => ({ ok: true as const }));
    const insert = vi.fn();
    const held = await upsertClient(
      input(),
      store({
        phones: async () => ({ hits: [{ id: CLIENT, archived: true }] }),
        unarchive,
        insert,
      }),
    );
    expect(held).toEqual({ status: 409, error: "archived" });
    expect(unarchive).not.toHaveBeenCalled();

    const restored = await upsertClient(
      input({ unarchive: true }),
      store({
        phones: async () => ({ hits: [{ id: CLIENT, archived: true }] }),
        unarchive,
        insert,
      }),
    );
    expect(restored).toEqual({ status: 200, client_id: CLIENT, created: false });
    expect(unarchive).toHaveBeenCalledWith(CLIENT);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not pick between two archived profiles", async () => {
    const unarchive = vi.fn();
    const result = await upsertClient(
      input({ unarchive: true }),
      store({
        phones: async () => ({
          hits: [
            { id: CLIENT, archived: true },
            { id: CLIENT_2, archived: true },
          ],
        }),
        unarchive,
      }),
    );
    expect(result).toEqual({ status: 409, error: "duplicate" });
    expect(unarchive).not.toHaveBeenCalled();
  });

  it("rejects an unknown or shared first name", async () => {
    const phones = vi.fn(async () => ({ hits: [] }));
    const unknown = await upsertClient(
      input({ practitionerFirstName: "Quinn" }),
      store({ phones }),
    );
    expect(unknown).toEqual({ status: 400, error: "unknown_practitioner" });
    expect(phones).not.toHaveBeenCalled();

    const shared = await upsertClient(
      input(),
      store({
        roster: async () => ({
          people: [
            { id: PRAC, fullName: "Zoe Naude", role: "practitioner" },
            { id: PRAC_2, fullName: "Zoe Botha", role: "practitioner" },
          ],
          practices: [
            { id: PRACTICE, ownerId: PRAC, approved: true },
            { id: PRACTICE_2, ownerId: PRAC_2, approved: true },
          ],
          members: [],
        }),
        phones,
      }),
    );
    expect(shared).toEqual({ status: 400, error: "unknown_practitioner" });
  });

  it("ignores a practitioner whose practice is not approved", async () => {
    const result = await upsertClient(
      input(),
      store({
        roster: async () => ({
          people: [{ id: PRAC, fullName: "Zoe Naude", role: "practitioner" }],
          practices: [{ id: PRACTICE, ownerId: PRAC, approved: false }],
          members: [],
        }),
      }),
    );
    expect(result).toEqual({ status: 400, error: "unknown_practitioner" });
  });

  it("returns 503 when the phone lookup fails", async () => {
    const insert = vi.fn();
    const result = await upsertClient(
      input(),
      store({ phones: async () => ({ error: true }), insert }),
    );
    expect(result).toEqual({ status: 503 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not create a second client for a Notion page already stored", async () => {
    const insert = vi.fn();
    const result = await upsertClient(
      input(),
      store({ notionOwner: async () => ({ ids: [CLIENT_2] }), insert }),
    );
    expect(result).toEqual({ status: 409, error: "duplicate" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("retries a login-code collision and returns the winner of a phone race", async () => {
    let n = 0;
    const codes = ["1111", "2222"];
    const retried = await upsertClient(
      input(),
      store({
        insert: async () => {
          n += 1;
          return n === 1 ? { error: true, unique: "login_code" } : { id: CLIENT };
        },
      }),
      () => codes[n] ?? "3333",
    );
    expect(retried).toEqual({ status: 200, client_id: CLIENT, created: true });
    expect(n).toBe(2);

    let reads = 0;
    const raced = await upsertClient(
      input(),
      store({
        phones: async () => {
          reads += 1;
          return reads === 1 ? { hits: [] } : { hits: [{ id: CLIENT, archived: false }] };
        },
        insert: async () => ({ error: true, unique: "phone" }),
      }),
    );
    expect(raced).toEqual({ status: 200, client_id: CLIENT, created: false });
  });

  it("returns 503 when the practitioner is on two practices and a new row is needed", async () => {
    const insert = vi.fn();
    const result = await upsertClient(
      input({ practitionerFirstName: "Tayla" }),
      store({
        roster: async () => ({
          people: [{ id: PRAC, fullName: "Tayla Field", role: "practitioner" }],
          practices: [
            { id: PRACTICE, ownerId: "owner-1", approved: true },
            { id: PRACTICE_2, ownerId: "owner-2", approved: true },
          ],
          members: [
            { userId: PRAC, practiceId: PRACTICE, status: "active" },
            { userId: PRAC, practiceId: PRACTICE_2, status: "active" },
          ],
        }),
        insert,
      }),
    );
    expect(result).toEqual({ status: 503 });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("active practitioners", () => {
  it("matches a first name, including a title and an accent", () => {
    expect(sameFirstName("zoe", "Dr. Zoë Naude")).toBe(true);
    expect(sameFirstName("Naude", "Zoe Naude")).toBe(false);
    const roster = activePractitionerRoster(
      [
        { id: PRAC, fullName: "Justin Muller", role: "super_admin" },
        { id: PRAC_2, fullName: "Tayla Field", role: "practitioner" },
        { id: "client-1", fullName: "Zoe Client", role: "client" },
      ],
      [
        { id: PRACTICE, ownerId: PRAC, approved: true },
        { id: PRACTICE_2, ownerId: "owner", approved: true },
      ],
      [
        { userId: PRAC_2, practiceId: PRACTICE_2, status: "active" },
        { userId: "client-1", practiceId: PRACTICE, status: "active" },
        { userId: "left", practiceId: PRACTICE_2, status: "inactive" },
      ],
    );
    expect(roster.map((p) => p.id).sort()).toEqual([PRAC, PRAC_2].sort());
  });

  it("stores Notion ids in one dashed form", () => {
    expect(canonicalNotionPageId("AAAAAAAABBBB4CCC8DDDEEEEEEEEEEEE")).toBe(PAGE);
    expect(canonicalNotionPageId(PAGE)).toBe(PAGE);
    expect(canonicalNotionPageId("page")).toBeNull();
  });
});

describe("storeFromAdmin", () => {
  it("inserts through clients only and unarchives by clearing the archive columns", async () => {
    const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
    const clients = [
      {
        id: CLIENT,
        phone: "082 000 0001",
        phone_e164: null,
        archived_at: "2026-10-01T00:00:00Z",
        notion_page_id: null,
      },
    ];
    const admin = fakeAdmin(
      {
        profiles: [{ id: PRAC, full_name: "Zoe Naude", role: "practitioner" }],
        practices: [{ id: PRACTICE, practitioner_id: PRAC, is_approved: true }],
        practice_members: [],
        clients,
      },
      calls,
    );

    const held = await upsertClient(input(), storeFromAdmin(admin));
    expect(held).toEqual({ status: 409, error: "archived" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);

    clients[0]!.archived_at = "2026-10-01T00:00:00Z";
    const restored = await upsertClient(input({ unarchive: true }), storeFromAdmin(admin));
    expect(restored).toEqual({ status: 200, client_id: CLIENT, created: false });
    expect(calls.filter((c) => c.op === "update").map((c) => c.payload)).toEqual([
      { archived_at: null, archived_by: null },
    ]);
    expect(
      calls.every(
        (c) =>
          c.table === "clients" ||
          c.table === "profiles" ||
          c.table === "practices" ||
          c.table === "practice_members",
      ),
    ).toBe(true);

    clients.length = 0;
    calls.length = 0;
    const created = await upsertClient(input(), storeFromAdmin(admin), () => "5678");
    expect(created).toEqual({ status: 200, client_id: CLIENT, created: true });
    const inserted = calls.find((c) => c.op === "insert")?.payload as NewClientRow;
    expect(inserted.popia_accepted).toBe(false);
    expect(inserted.yves_ai_consent).toBe(false);
    expect(inserted.phone).toBe("+27820000001");
    expect(inserted).not.toHaveProperty("primary_complaint");
  });
});

function fakeAdmin(
  tables: Record<string, Array<Record<string, unknown>>>,
  calls: Array<{ table: string; op: string; payload?: unknown }>,
): UpsertAdmin {
  return {
    from(table: string) {
      const filters: string[] = [];
      const read = {
        eq(col: string, value: string) {
          filters.push(`eq ${col}=${value}`);
          return read;
        },
        in(col: string, values: readonly string[]) {
          filters.push(`in ${col}=${values.join(",")}`);
          return read;
        },
        limit() {
          calls.push({ table, op: "select" });
          return Promise.resolve({ data: apply(tables[table] ?? [], filters), error: null });
        },
      };
      return {
        select() {
          return read;
        },
        insert(row: NewClientRow) {
          calls.push({ table, op: "insert", payload: row });
          return {
            select() {
              return {
                single: () => Promise.resolve({ data: { id: CLIENT }, error: null }),
              };
            },
          };
        },
        update(row: { archived_at: null; archived_by: null }) {
          return {
            eq(col: string, value: string) {
              filters.push(`eq ${col}=${value}`);
              return {
                not(col2: string, op: string, value: null) {
                  filters.push(`not ${col2} ${op} ${String(value)}`);
                  return {
                    select() {
                      calls.push({ table, op: "update", payload: row });
                      return Promise.resolve({ data: [{ id: CLIENT }], error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function apply(
  rows: Array<Record<string, unknown>>,
  filters: string[],
): Array<Record<string, unknown>> {
  let out = rows;
  for (const filter of filters) {
    const eq = /^eq ([^=]+)=(.*)$/.exec(filter);
    if (eq?.[1]) {
      const col = eq[1];
      out = out.filter((row) => String(row[col] ?? "") === eq[2]);
    }
    const inn = /^in ([^=]+)=(.*)$/.exec(filter);
    if (inn?.[1]) {
      const col = inn[1];
      const allowed = new Set((inn[2] ?? "").split(","));
      out = out.filter((row) => allowed.has(String(row[col] ?? "")));
    }
  }
  return out;
}

describe("hook module", () => {
  it("does not import a send, consent-link, or Add Client path", () => {
    const src = readFileSync(new URL("./client-upsert-api.server.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(
      /sendLogged|sendWhatsApp|mintConsentLink|createClientAccount|whatsapp_outbound/,
    );
  });
});
