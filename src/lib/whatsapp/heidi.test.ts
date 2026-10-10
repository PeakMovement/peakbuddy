import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const push = vi.fn(async () => ({}));
vi.mock("@/lib/push.functions", () => ({ sendPushCore: push }));

import {
  buildHeidiSummary,
  HEIDI_MSG,
  HEIDI_REPLY_CAP,
  HEIDI_STORE_CAP,
  heidiLinkUrl,
  heidiPatientMatches,
  readHeidiCommand,
  selectLinkedSessions,
} from "./heidi";
import { handleHeidiTurn, heidiConfig, resetHeidiCache } from "./heidi.server";

const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOTE = "PHI_MARKER_NOTE left knee effusion on examination";
const TRANSCRIPT = "PHI_MARKER_TRANSCRIPT patient described the week";
const EMAIL = "phi-marker@example.com";
const TOKEN = "jwt-phi-token";
const SESSION = "sess-phi-marker";
const NOW = new Date("2026-10-09T10:00:00Z");
const PATIENTS = [
  { id: CLIENT, full_name: "Sam Kruger" },
  { id: OTHER, full_name: "Sam Petersen" },
];

function fakeAdmin(opts: {
  email?: string | null;
  phone?: string | null;
  inboundAt?: string | null;
  stored?: { heidi_patient_profile_id: string | null; session_ids: string[] } | null;
} = {}) {
  const saved: Array<Record<string, unknown>> = [];
  const from = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.in = self;
    api.order = self;
    api.limit = () =>
      Promise.resolve({
        data: table === "whatsapp_inbound" && opts.inboundAt ? [{ received_at: opts.inboundAt }] : [],
      });
    api.maybeSingle = () => {
      if (table === "profiles") return Promise.resolve({ data: { full_name: "Zoe Bredenkamp" } });
      if (table === "heidi_records") return Promise.resolve({ data: opts.stored ?? null });
      return Promise.resolve({ data: null });
    };
    api.upsert = (row: Record<string, unknown>) => {
      saved.push(row);
      return Promise.resolve({ error: null });
    };
    return api;
  };
  return {
    saved,
    admin: {
      from,
      auth: {
        admin: {
          getUserById: async () => ({
            data: {
              user: {
                email: opts.email === undefined ? EMAIL : opts.email,
                phone: opts.phone === undefined ? "27821112222" : opts.phone,
              },
            },
          }),
        },
      },
    } as never,
  };
}

function json(body: unknown, status = 200) {
  return { status, json: async () => body };
}

describe("Heidi command parsing", () => {
  it.each([
    ["get Sam Kruger's files", "Sam Kruger"],
    ["get Sam Kruger from Heidi", "Sam Kruger"],
    ["what does Heidi say about Sam Kruger", "Sam Kruger"],
    ["Get the files for Sam Kruger", "Sam Kruger"],
  ])("reads %s", (text, name) => {
    expect(readHeidiCommand(text, null)).toEqual({ kind: "ask", name });
  });

  it("reads a chosen client id and ignores ordinary chat", () => {
    expect(readHeidiCommand("ok", `heidi_${CLIENT}`)).toEqual({ kind: "pick", clientId: CLIENT });
    expect(readHeidiCommand("how are my clients doing?", null)).toBeNull();
  });

  it("requires a first and last name", () => {
    expect(heidiPatientMatches("Sam", PATIENTS)).toEqual([]);
    expect(heidiPatientMatches("Sam Kruger", PATIENTS).map((p) => p.id)).toEqual([CLIENT]);
    expect(heidiPatientMatches("Sam Kruger and Sam Petersen", PATIENTS)).toHaveLength(2);
  });

  it("drops linked-user rows that are not this client", () => {
    const picked = selectLinkedSessions(
      [
        { session_id: SESSION, ehr_patient_id: CLIENT, created_at: "2026-10-01T00:00:00Z" },
        { session_id: "sess-other-patient", ehr_patient_id: "someone-else", created_at: "2026-10-02T00:00:00Z" },
        { session_id: "sess-no-id", created_at: "2026-10-03T00:00:00Z" },
      ],
      CLIENT,
      null,
    );
    expect(picked.usable).toBe(true);
    expect(picked.ids.map((s) => s.id)).toEqual([SESSION]);
  });

  it("does not treat an unlabelled session list as this client", () => {
    expect(selectLinkedSessions([{ session_id: "sess-no-id" }], CLIENT, null).usable).toBe(false);
  });

  it("caps the stored summary and the reply", () => {
    const built = buildHeidiSummary([
      {
        id: "s",
        at: "2026-10-01T08:00:00Z",
        note: "Q".repeat(5000),
        transcript: null,
        documents: [{ name: "Scan", content: null }],
      },
    ]);
    expect(built.stored.length).toBe(HEIDI_STORE_CAP);
    expect(built.reply.length).toBe(HEIDI_REPLY_CAP);
    expect(built.reply.startsWith("Q")).toBe(true);
  });
});

describe("Heidi reads", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const calls: Array<{ method: string; url: string }> = [];

  beforeEach(() => {
    process.env.HEIDI_API_KEY = "test-key";
    process.env.HEIDI_REGION = "eu";
    process.env.HEIDI_EHR_PROVIDER = "peakbuddy";
    resetHeidiCache();
    push.mockClear();
    warn.mockClear();
    calls.length = 0;
  });

  afterEach(() => {
    delete process.env.HEIDI_API_KEY;
    delete process.env.HEIDI_REGION;
    delete process.env.HEIDI_EHR_PROVIDER;
    vi.unstubAllGlobals();
  });

  function install(handler: (path: string) => { status: number; json: () => Promise<unknown> }) {
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ method: init?.method ?? "GET", url: String(url) });
      const path = String(url).replace(/^https:\/\/[^/]+\/api\/v2\/ml-scribe\/open-api\//, "");
      return handler(path);
    });
  }

  function loggedText(): string {
    return warn.mock.calls.map((args) => JSON.stringify(args)).join("\n");
  }

  function linkedApi(opts: {
    linked?: boolean;
    profiles?: unknown;
    page?: unknown;
    sessions?: unknown;
    session?: unknown;
    documents?: { status: number; body: unknown };
  }) {
    install((path) => {
      if (path.startsWith("jwt?")) {
        return json({ token: TOKEN, expiration_time: "2099-01-01T00:00:00Z" });
      }
      if (path.startsWith("users/linked-account/access")) {
        return json({ is_linked: opts.linked !== false });
      }
      if (path.startsWith("patient-profiles?") && path.includes("ehr_patient_id=")) {
        return json({ data: opts.profiles ?? [], total_pages: 1 });
      }
      if (path.startsWith("patient-profiles?")) {
        return json({ data: opts.page ?? [], total_pages: 1 });
      }
      if (path.startsWith("sessions/linked-user")) {
        return json({ sessions: opts.sessions ?? [], count: 0, has_next_page: false });
      }
      if (path.includes("/documents") && !path.includes("context-documents")) {
        const doc = opts.documents ?? { status: 200, body: [{ name: "Scan", content: null }] };
        return json(doc.body, doc.status);
      }
      if (path.includes("/context-documents")) {
        return json([{ name: "Referral letter", content: null }]);
      }
      if (path.includes("/transcript")) return json({ transcript: TRANSCRIPT });
      if (path.startsWith("sessions/")) return json(opts.session ?? {});
      return json({}, 404);
    });
  }

  async function turn(
    text: string,
    extra: Parameters<typeof fakeAdmin>[0] = {},
    replyId: string | null = null,
    patients = PATIENTS,
  ) {
    const db = fakeAdmin({ inboundAt: "2026-10-09T09:30:00Z", ...extra });
    const replies: Array<{ kind: string; body: string; rows?: Array<{ id: string }> }> = [];
    const cmd = readHeidiCommand(text, replyId);
    expect(cmd).not.toBeNull();
    await handleHeidiTurn(db.admin, { userId: "zoe", firstName: "Zoe" }, cmd!, patients, {
      now: NOW,
      reply: async (m) => void replies.push(m as never),
    });
    return { db, replies };
  }

  it("stays off when the region is not one Heidi publishes", () => {
    process.env.HEIDI_REGION = "za";
    expect(heidiConfig()).toBeNull();
  });

  it("asks which client when two names match and does not call Heidi", async () => {
    install(() => json({}));
    const { replies } = await turn("what does Heidi say about Sam Kruger and Sam Petersen");
    expect(replies[0].kind).toBe("list");
    expect(replies[0].body).toBe(HEIDI_MSG.which);
    expect(replies[0].rows?.map((r) => r.id).sort()).toEqual([`heidi_${CLIENT}`, `heidi_${OTHER}`]);
    expect(calls).toHaveLength(0);
  });

  it("does not fetch from a first name alone", async () => {
    install(() => json({}));
    const { replies } = await turn("get Sam's files");
    expect(replies[0].body).toBe(HEIDI_MSG.needFullName("Zoe"));
    expect(calls).toHaveLength(0);
  });

  it("does not fetch when nobody on the list matches", async () => {
    install(() => json({}));
    const { replies } = await turn("get Robin Naidoo's files");
    expect(replies[0].body).toBe(HEIDI_MSG.notOnList("Zoe"));
    expect(calls).toHaveLength(0);
  });

  it("replies with the link only when the practitioner has not linked Heidi", async () => {
    linkedApi({ linked: false });
    const { replies } = await turn("get Sam Kruger's files");
    expect(replies[0].body).toBe(heidiLinkUrl("eu", TOKEN));
    expect(calls.some((c) => c.url.includes("patient-profiles"))).toBe(false);
    expect(loggedText()).not.toContain(TOKEN);
    expect(loggedText()).not.toContain(EMAIL);
  });

  it("says when the client is not in this Heidi account", async () => {
    linkedApi({ profiles: [], page: [], sessions: [] });
    const { replies } = await turn("get Sam Kruger from Heidi");
    expect(replies[0].body).toBe(HEIDI_MSG.notInHeidi("Sam Kruger"));
  });

  it("says when a profile exists but no session id can be matched", async () => {
    linkedApi({
      profiles: [],
      page: [{ id: "pp1", first_name: "Sam", last_name: "Kruger" }],
      sessions: [],
    });
    const { replies } = await turn("get Sam Kruger's files");
    expect(replies[0].body).toBe(HEIDI_MSG.nothingToRead("Sam Kruger"));
    expect(replies[0].body).toContain("does not offer a list");
  });

  it("reads a matched session and keeps clinical text out of the logs", async () => {
    linkedApi({
      profiles: [],
      page: [{ id: "pp1", first_name: "Sam", last_name: "Kruger" }],
      sessions: [
        { session_id: SESSION, ehr_patient_id: CLIENT, created_at: "2026-10-01T08:00:00Z" },
        { session_id: "sess-other-patient", ehr_patient_id: "someone-else", created_at: "2026-10-08T08:00:00Z" },
      ],
      session: {
        session_id: SESSION,
        ehr_patient_id: CLIENT,
        created_at: "2026-10-01T08:00:00Z",
        consult_note: { status: "COMPLETED", result: NOTE },
      },
      documents: { status: 500, body: { detail: NOTE } },
    });
    const { db, replies } = await turn("get the files for Sam Kruger");
    expect(replies[0].body).toContain("Sam Kruger");
    expect(replies[0].body).toContain("Newest note:");
    expect(replies[0].body).toContain(NOTE);
    expect(replies[0].body).toContain(TRANSCRIPT);
    expect(replies[0].body).toContain("Referral letter: the text was not in the API response");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url.includes("consult-note"))).toBe(false);
    expect(calls.some((c) => c.url.includes("sess-other-patient"))).toBe(false);
    expect(db.saved[0]).toMatchObject({ client_id: CLIENT, practitioner_id: "zoe", heidi_patient_profile_id: "pp1" });
    const logged = loggedText();
    expect(logged).toContain("documents");
    expect(logged).not.toContain(NOTE);
    expect(logged).not.toContain(TRANSCRIPT);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(CLIENT);
    expect(logged).not.toContain(SESSION);
    expect(logged).not.toContain("heidihealth.com");
    expect(logged).not.toContain(TOKEN);
  });

  it("uses stored session ids when the linked-user list has no patient identifier", async () => {
    linkedApi({
      profiles: [{ id: "pp1", ehr_patient_id: CLIENT, first_name: "Sam", last_name: "Kruger" }],
      sessions: [{ session_id: "sess-unlabelled", created_at: "2026-10-08T08:00:00Z" }],
      session: {
        session_id: "stored-session",
        ehr_patient_id: CLIENT,
        created_at: "2026-09-01T08:00:00Z",
        consult_note: { status: "COMPLETED", result: "Stored note text" },
      },
    });
    const { replies } = await turn("get Sam Kruger's files", {
      stored: { heidi_patient_profile_id: "pp1", session_ids: ["stored-session"] },
    });
    expect(replies[0].body).toContain("Stored note text");
    expect(calls.some((c) => c.url.includes("sessions/stored-session"))).toBe(true);
    expect(calls.some((c) => c.url.includes("sess-unlabelled"))).toBe(false);
  });

  it("keeps the WhatsApp reply inside the summary cap", async () => {
    linkedApi({
      profiles: [{ id: "pp1", first_name: "Sam", last_name: "Kruger" }],
      sessions: [{ session_id: SESSION, ehr_patient_id: CLIENT, created_at: "2026-10-01T08:00:00Z" }],
      session: {
        session_id: SESSION,
        ehr_patient_id: CLIENT,
        created_at: "2026-10-01T08:00:00Z",
        consult_note: { status: "COMPLETED", result: "Q".repeat(5000) },
      },
    });
    const { db, replies } = await turn("get Sam Kruger's files");
    const summaryLine = replies[0].body.split("\n").slice(2).join("\n");
    expect(summaryLine.length).toBeLessThanOrEqual(HEIDI_REPLY_CAP);
    expect(String(db.saved[0].summary).length).toBeLessThanOrEqual(HEIDI_STORE_CAP);
    expect(String(db.saved[0].summary).length).toBe(HEIDI_STORE_CAP);
  });

  it("sends a push without the note when the WhatsApp window is closed", async () => {
    linkedApi({
      profiles: [{ id: "pp1", first_name: "Sam", last_name: "Kruger" }],
      sessions: [{ session_id: SESSION, ehr_patient_id: CLIENT, created_at: "2026-10-01T08:00:00Z" }],
      session: {
        session_id: SESSION,
        ehr_patient_id: CLIENT,
        created_at: "2026-10-01T08:00:00Z",
        consult_note: { status: "COMPLETED", result: NOTE },
      },
    });
    const db = fakeAdmin({ inboundAt: "2026-10-01T08:00:00Z" });
    const replies: Array<{ body: string }> = [];
    const cmd = readHeidiCommand("get Sam Kruger's files", null)!;
    await handleHeidiTurn(db.admin, { userId: "zoe", firstName: "Zoe" }, cmd, PATIENTS, {
      now: NOW,
      reply: async (m) => void replies.push(m as { body: string }),
    });
    expect(replies[0].body).toBe(HEIDI_MSG.readyInApp("Sam Kruger"));
    expect(replies[0].body).not.toContain(NOTE);
    expect(push).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: HEIDI_MSG.readyInApp("Sam Kruger"), title: "Buddy" }),
    );
  });

  it("reuses the jwt until it expires", async () => {
    linkedApi({ linked: false });
    await turn("get Sam Kruger's files");
    await turn("get Sam Kruger's files");
    expect(calls.filter((c) => c.url.includes("/jwt?"))).toHaveLength(1);
  });
});
