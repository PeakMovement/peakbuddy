import { afterEach, describe, expect, it, vi } from "vitest";
import { mintWatchToken, verifyWatchToken, watchTokenExpiresAt } from "./watch-link.server";
import {
  findActiveClientByPhone,
  handleWatchLinkRequest,
  issueWatchLink,
  phoneLookup,
  takeRateSlot,
  timingSafeEqualString,
  type ClientPhoneAdmin,
  type IssueResult,
  type PhoneLookup,
} from "./watch-link-api.server";

const KEY = "test-watch-secret";
const ID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-23T04:00:00Z");
const API_SECRET = "watch-link-api-secret-value";

const saved: Record<string, string | undefined> = {};
afterEach(() => {
  for (const k of ["WATCH_LINK_SECRET", "WATCH_LINK_API_SECRET"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function rememberEnv() {
  for (const k of ["WATCH_LINK_SECRET", "WATCH_LINK_API_SECRET"]) {
    if (!(k in saved)) saved[k] = process.env[k];
  }
}

function post(phone: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request("https://example.test/api/public/hooks/watch-link", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify({ phone }),
  });
}

function auth(secret = API_SECRET): Record<string, string> {
  return { authorization: `Bearer ${secret}` };
}

describe("watch-link hook auth", () => {
  it("compares secrets without trusting length alone", () => {
    expect(timingSafeEqualString("same", "same")).toBe(true);
    expect(timingSafeEqualString("same", "same ")).toBe(false);
    expect(timingSafeEqualString("short", "much-longer-secret")).toBe(false);
    expect(timingSafeEqualString("", "secret")).toBe(false);
  });

  it("stays off when the secret is unset", async () => {
    rememberEnv();
    delete process.env.WATCH_LINK_API_SECRET;
    const issue = vi.fn();
    const res = await handleWatchLinkRequest(post("+27820000001", auth()), {
      secret: null,
      issue,
    });
    expect(res.status).toBe(404);
    expect(issue).not.toHaveBeenCalled();
  });

  it("rejects a missing or wrong secret", async () => {
    const issue = vi.fn();
    const missing = await handleWatchLinkRequest(post("+27820000001"), {
      secret: API_SECRET,
      issue,
    });
    const wrong = await handleWatchLinkRequest(post("+27820000001", auth("nope")), {
      secret: API_SECRET,
      issue,
    });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(issue).not.toHaveBeenCalled();
  });

  it("accepts the secret in the header or as a bearer token", async () => {
    const issue = vi.fn(
      async (): Promise<IssueResult> => ({
        status: 200,
        url: "https://x.test/connect-watch?t=abc",
        expires_at: "2026-11-30T04:00:00.000Z",
      }),
    );
    const bearer = await handleWatchLinkRequest(post("+27820000001", auth()), {
      secret: API_SECRET,
      now: NOW,
      issue,
    });
    const header = await handleWatchLinkRequest(
      post("+27820000001", { "x-watch-link-secret": API_SECRET }),
      { secret: API_SECRET, now: NOW, phoneBuckets: new Map(), issue },
    );
    expect(bearer.status).toBe(200);
    expect(header.status).toBe(200);
    expect(await bearer.json()).toEqual({
      url: "https://x.test/connect-watch?t=abc",
      expires_at: "2026-11-30T04:00:00.000Z",
    });
    expect(issue).toHaveBeenCalledWith("27820000001", NOW);
  });
});

describe("watch-link hook requests", () => {
  it("normalises the phone and hides an unknown number", async () => {
    const issue = vi.fn(async (): Promise<IssueResult> => ({ status: 404 }));
    const res = await handleWatchLinkRequest(post("082 000 0001", auth()), {
      secret: API_SECRET,
      now: NOW,
      issue,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(issue).toHaveBeenCalledWith("27820000001", NOW);
  });

  it("rejects a bad body without calling the lookup", async () => {
    const issue = vi.fn();
    const res = await handleWatchLinkRequest(post("12", auth()), {
      secret: API_SECRET,
      issue,
    });
    expect(res.status).toBe(400);
    expect(issue).not.toHaveBeenCalled();
  });

  it("rate limits repeats for one number", async () => {
    const buckets = new Map<string, number[]>();
    const issue = vi.fn(
      async (): Promise<IssueResult> => ({
        status: 200,
        url: "https://x.test/connect-watch?t=abc",
        expires_at: "2026-11-30T04:00:00.000Z",
      }),
    );
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const res = await handleWatchLinkRequest(post("+27820000001", auth()), {
        secret: API_SECRET,
        now: NOW,
        phoneBuckets: buckets,
        issue,
      });
      last = res.status;
    }
    expect(last).toBe(429);
    expect(issue).toHaveBeenCalledTimes(30);
  });

  it("does not put a thrown error into the response", async () => {
    const issue = vi.fn(async () => {
      throw new Error("token abc secret leaked");
    });
    const res = await handleWatchLinkRequest(post("+27820000001", auth()), {
      secret: API_SECRET,
      issue,
    });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("leaked");
  });
});

describe("active client lookup", () => {
  const lookup = (over: Partial<PhoneLookup> = {}): PhoneLookup => ({
    byE164: async () => ({ ids: [] }),
    scan: async () => ({ rows: [] }),
    ...over,
  });

  it("matches a typed South African number to one active profile", async () => {
    const found = await findActiveClientByPhone(
      "082 000 0001",
      lookup({
        scan: async () => ({
          rows: [
            { id: ID, phone: "+27 82 000 0001", phone_e164: null },
            { id: "22222222-2222-4333-8444-555555555555", phone: "0830000002", phone_e164: null },
          ],
        }),
      }),
    );
    expect(found).toEqual({ ok: true, clientId: ID });
  });

  it("uses the phone index when it has exactly one row", async () => {
    let scanned = false;
    const found = await findActiveClientByPhone(
      "+27820000001",
      lookup({
        byE164: async () => ({ ids: [ID] }),
        scan: async () => {
          scanned = true;
          return { rows: [] };
        },
      }),
    );
    expect(found).toEqual({ ok: true, clientId: ID });
    expect(scanned).toBe(false);
  });

  it("does not pick when two active profiles share the number", async () => {
    const found = await findActiveClientByPhone(
      "+27820000001",
      lookup({
        byE164: async () => ({ ids: [ID, "22222222-2222-4333-8444-555555555555"] }),
      }),
    );
    expect(found).toEqual({ ok: false, reason: "not_found" });
  });

  it("asks only for clients that are not archived", async () => {
    const calls: string[] = [];
    const chain = (cols: string) => {
      const api = {
        eq(col: string, value: string) {
          calls.push(`eq ${col}=${value}`);
          return api;
        },
        is(col: string, value: null) {
          calls.push(`is ${col} ${cols}`);
          return api;
        },
        limit() {
          if (cols === "id") return Promise.resolve({ data: [{ id: ID }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
      return api;
    };
    const admin = {
      from() {
        return { select: (cols: string) => chain(cols) };
      },
    } as unknown as ClientPhoneAdmin;
    const found = await findActiveClientByPhone("+27820000001", phoneLookup(admin));
    expect(found).toEqual({ ok: true, clientId: ID });
    expect(calls.some((c) => c.startsWith("is archived_at"))).toBe(true);
  });
});

describe("issueWatchLink", () => {
  it("returns a signed connect-watch url and its expiry", async () => {
    rememberEnv();
    process.env.WATCH_LINK_SECRET = KEY;
    const result = await issueWatchLink(
      "+27820000001",
      NOW,
      { byE164: async () => ({ ids: [ID] }), scan: async () => ({ rows: [] }) },
      "https://buddy.example",
    );
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    const token = decodeURIComponent(new URL(result.url).searchParams.get("t") ?? "");
    expect(result.url.startsWith("https://buddy.example/connect-watch?t=")).toBe(true);
    expect(result.expires_at).toBe(watchTokenExpiresAt(token));
    expect(await verifyWatchToken(token, NOW, KEY)).toBe(ID);
    expect(await mintWatchToken(ID, NOW, KEY)).toBe(token);
  });
});

describe("takeRateSlot", () => {
  it("allows a fresh window after the old hits expire", () => {
    const buckets = new Map<string, number[]>();
    expect(takeRateSlot(buckets, "k", 0, 1, 1000)).toBe(false);
    expect(takeRateSlot(buckets, "k", 10, 1, 1000)).toBe(true);
    expect(takeRateSlot(buckets, "k", 2000, 1, 1000)).toBe(false);
  });
});
