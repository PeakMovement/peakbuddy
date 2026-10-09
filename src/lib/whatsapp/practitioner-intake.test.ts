import { describe, expect, it, vi } from "vitest";
import { appendNote, handlePractitionerReply, shortName } from "./practitioner-intake.server";

const ID = "11111111-2222-3333-4444-555555555555";
const now = new Date("2026-10-09T10:00:00Z");

function fakeDb(intake: Record<string, unknown> | null, notes = "") {
  const state = { intake: intake ? { ...intake } : null, notes, updates: [] as unknown[] };
  const chain = (table: string) => {
    let filters: Record<string, unknown> = {};
    const api: any = {
      select: () => api,
      eq: (k: string, v: unknown) => ((filters[k] = v), api),
      order: () => api,
      limit: () =>
        Promise.resolve({
          data:
            table === "practitioner_intakes" &&
            state.intake &&
            state.intake.phone === filters.phone &&
            state.intake.status === filters.status
              ? [state.intake]
              : [],
        }),
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === "clients"
              ? { id: "c1", full_name: "Sam Kruger", notes: state.notes }
              : state.intake && state.intake.id === filters.id
                ? state.intake
                : null,
        }),
      update: (u: Record<string, unknown>) => ({
        eq: () => {
          state.updates.push({ table, u });
          if (table === "clients") state.notes = String(u.notes);
          if (table === "practitioner_intakes" && state.intake) Object.assign(state.intake, u);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return api;
  };
  return { admin: { from: chain } as never, state };
}

function deps(sent: string[], transcript: string | null = null) {
  return { now, send: async (b: string) => void sent.push(b), transcribe: async () => transcript };
}

const base = {
  id: ID,
  client_id: "c1",
  phone: "27820000009",
  status: "sent",
  created_at: new Date(now.getTime() - 3_600_000).toISOString(),
  last_message_at: null,
  opened_at: null,
};

describe("practitioner intake", () => {
  it("short names keep only a surname initial", () => {
    expect(shortName("Sam Kruger")).toBe("Sam K.");
    expect(shortName("Sam")).toBe("Sam");
    expect(shortName("")).toBe("A new patient");
  });

  it("Add details opens collecting and asks for the brief", async () => {
    const { admin, state } = fakeDb(base);
    const sent: string[] = [];
    const ok = await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "", replyId: `intake_add:${ID}`, isAudio: false },
      deps(sent),
    );
    expect(ok).toBe(true);
    expect(state.intake?.status).toBe("collecting");
    expect(sent[0]).toContain("tell me about Sam K.");
  });

  it("only the practitioner it was sent to can answer", async () => {
    const { admin } = fakeDb(base);
    const ok = await handlePractitionerReply(
      admin,
      { phone: "27829999999", text: "", replyId: `intake_add:${ID}`, isAudio: false },
      deps([]),
    );
    expect(ok).toBe(false);
  });

  it("appends the brief to profile notes, then DONE closes it", async () => {
    const { admin, state } = fakeDb({ ...base, status: "collecting", opened_at: now.toISOString() }, "Old note");
    const sent: string[] = [];
    await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "ACL recon 2 Oct, no running until week 12", replyId: null, isAudio: false },
      deps(sent),
    );
    expect(state.notes).toContain("Old note");
    expect(state.notes).toContain("[2026-10-09, via WhatsApp] ACL recon 2 Oct, no running until week 12");
    await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "Done", replyId: null, isAudio: false },
      deps(sent),
    );
    expect(state.intake?.status).toBe("done");
    expect(sent.at(-1)).toContain("never share your notes");
  });

  it("uses the voice note transcript", async () => {
    const { admin, state } = fakeDb({ ...base, status: "collecting", opened_at: now.toISOString() });
    await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "", replyId: null, isAudio: true },
      deps([], "Goal is the Two Oceans half"),
    );
    expect(state.notes).toContain("Two Oceans");
  });

  it("Not now declines", async () => {
    const { admin, state } = fakeDb(base);
    const sent: string[] = [];
    await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "", replyId: `intake_skip:${ID}`, isAudio: false },
      deps(sent),
    );
    expect(state.intake?.status).toBe("declined");
  });

  it("ignores messages when nothing is being collected", async () => {
    const { admin } = fakeDb(base);
    const ok = await handlePractitionerReply(
      admin,
      { phone: "27820000009", text: "hi", replyId: null, isAudio: false },
      deps([]),
    );
    expect(ok).toBe(false);
  });

  it("dates notes in SA time", () => {
    expect(appendNote("", "x", new Date("2026-10-09T23:30:00Z"))).toBe("[2026-10-10, via WhatsApp] x");
  });
});

describe("telling the practitioner about a new patient", () => {
  function db(practitioner: { phone: string | null; email: string | null }) {
    const intakes: Record<string, unknown>[] = [];
    const from = (t: string) => {
      const api: any = {
        select: () => api,
        eq: () => api,
        maybeSingle: () =>
          Promise.resolve({
            data:
              t === "clients"
                ? { id: "c1", full_name: "Sam Kruger", practitioner_id: "p1" }
                : t === "profiles"
                  ? { full_name: "Tristan Titus" }
                  : intakes[0] ?? null,
          }),
        insert: (row: Record<string, unknown>) => {
          intakes.push({ id: "11111111-2222-3333-4444-555555555555", ...row });
          return { select: () => ({ single: () => Promise.resolve({ data: intakes.at(-1), error: null }) }) };
        },
        update: (u: Record<string, unknown>) => ({ eq: () => (Object.assign(intakes[0], u), Promise.resolve({})) }),
      };
      return api;
    };
    const admin = {
      from,
      auth: { admin: { getUserById: async () => ({ data: { user: practitioner } }) } },
    };
    return { admin: admin as never, intakes };
  }

  it("emails when there is no mobile on their profile", async () => {
    vi.resetModules();
    const sendEmail = vi.fn(async () => ({ ok: true, queued: true }));
    vi.doMock("@/lib/email/send-server", () => ({ sendTransactionalEmailServer: sendEmail }));
    const { notifyPractitionerOfNewPatient } = await import("./practitioner-intake.server");
    const { admin, intakes } = db({ phone: null, email: "tristan@example.com" });
    expect(await notifyPractitionerOfNewPatient(admin, "c1")).toBe("emailed");
    expect(intakes[0].status).toBe("emailed");
    const call = (sendEmail.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(call).toMatchObject({ templateName: "practitioner-new-patient", recipientEmail: "tristan@example.com" });
    expect(call.templateData.patientName).toBe("Sam K.");
    expect(call.templateData.practitionerName).toBe("Tristan");
    expect(call.templateData.profileUrl).toContain("/practitioner/app/client-detail/c1");
  });

  it("emails while the WhatsApp template is not switched on, even with a mobile", async () => {
    vi.resetModules();
    delete process.env.WHATSAPP_INTAKE_TEMPLATE;
    const sendEmail = vi.fn(async () => ({ ok: true, queued: true }));
    vi.doMock("@/lib/email/send-server", () => ({ sendTransactionalEmailServer: sendEmail }));
    const { notifyPractitionerOfNewPatient } = await import("./practitioner-intake.server");
    const { admin } = db({ phone: "0821234567", email: "tristan@example.com" });
    expect(await notifyPractitionerOfNewPatient(admin, "c1")).toBe("emailed");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
