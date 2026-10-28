/**
 * Contacts are not patients. The practitioner confirms the exact words, Edit
 * replaces them, and nothing is sent before Yes. A patient number stays on
 * the patient path. STOP, the closed window, and promote each have a case.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTACT_INTRO_TEMPLATE,
  CONTACT_OPT_OUT,
  contactPreview,
  contactTemplateMissing,
  normaliseContactPhone,
  readContactMessage,
  readPromoteContact,
} from "./contact-message";
import { handlePractitionerMessage, type PractitionerDeps } from "./practitioner-mode.server";
import { readPracMemory, writePracMemory, type PracMemory } from "./practitioner-understand";
import { MESSAGE_MSG } from "./patient-questions.server";
import type { OutboundMessage, WhatsAppProvider } from "./provider";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const JUSTIN = { userId: "justin", firstName: "Justin" };
const SARAH_PATIENT = "99999999-9999-4999-8999-999999999999";
const CAYLA = "11111111-1111-4111-8111-111111111111";
const PHONE = "+27821234567";
const DIGITS = "27821234567";

type Row = Record<string, unknown>;

interface FakeQuery extends PromiseLike<{ data: Row[]; error: null }> {
  select: () => FakeQuery;
  eq: (k: string, v: unknown) => FakeQuery;
  in: (k: string, v: unknown[]) => FakeQuery;
  gte: (k: string, v: unknown) => FakeQuery;
  lt: (k: string, v: unknown) => FakeQuery;
  is: (k: string, v: unknown) => FakeQuery;
  not: (k: string, op: string, v: unknown) => FakeQuery;
  order: () => FakeQuery;
  limit: () => FakeQuery;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  update: (p: Row) => FakeQuery;
  delete: () => FakeQuery;
  insert: (r: Row | Row[]) => Promise<{ data: Row[]; error: null }>;
}

function fakeDb(tables: Record<string, Row[]>) {
  const from = (table: string): FakeQuery => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let remove = false;
    const rows = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)));
    const api: FakeQuery = {
      select: () => api,
      eq: (k, v) => (filters.push((r) => r[k] === v), api),
      in: (k, v) => (filters.push((r) => v.some((item) => item === r[k])), api),
      gte: (k, v) => (filters.push((r) => String(r[k] ?? "") >= String(v)), api),
      lt: (k, v) => (filters.push((r) => String(r[k] ?? "") < String(v)), api),
      is: (k, v) => (filters.push((r) => (r[k] ?? null) === v), api),
      not: (k, op, v) => (
        filters.push((r) => (op === "is" && v === null ? (r[k] ?? null) !== null : true)),
        api
      ),
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      update: (p) => ((patch = p), api),
      delete: () => ((remove = true), api),
      insert: (r) => {
        const list = Array.isArray(r) ? r : [r];
        for (const row of list) (tables[table] ??= []).push(row);
        return Promise.resolve({ data: list, error: null });
      },
      then: (res, rej) => {
        const hit = rows();
        if (remove) {
          const drop = new Set(hit);
          tables[table] = (tables[table] ?? []).filter((r) => !drop.has(r));
        } else if (patch) for (const r of hit) Object.assign(r, patch);
        return Promise.resolve({ data: hit, error: null, count: hit.length }).then(res, rej);
      },
    };
    return api;
  };
  return { from, t: tables };
}

function baseTables(): Record<string, Row[]> {
  return {
    practices: [{ id: "pm", practitioner_id: "justin", practice_name: "Peak Movement" }],
    practice_members: [],
    profiles: [{ id: "justin", full_name: "Justin Owner", role: "super_admin" }],
    clients: [
      {
        id: CAYLA,
        full_name: "Cayla Rosenblatt",
        practitioner_id: "justin",
        practice_id: "pm",
        auth_user_id: null,
        created_at: "2026-09-01T00:00:00Z",
        phone: null,
      },
    ],
    whatsapp_contacts: [],
    whatsapp_inbound: [],
    whatsapp_conversations: [],
    whatsapp_outbound: [],
    patient_questions: [],
    consent_links: [],
    consent_records: [],
    check_ins: [],
    alerts: [],
    checkin_reminders: [],
  };
}

type Reply = { body?: string; buttons?: Array<{ id: string; title: string }> };

function harness() {
  const sent: OutboundMessage[] = [];
  const replies: Reply[] = [];
  const db = fakeDb(baseTables());
  const provider: WhatsAppProvider = {
    id: "meta",
    verifySignature: async () => true,
    parseWebhook: () => ({ messages: [], statuses: [] }),
    send: async (message) => {
      sent.push(message);
      return { providerMessageId: `m${sent.length}` };
    },
  };
  const deps: PractitionerDeps = {
    provider,
    secrets: { signingSecret: "test", senderId: "1" },
    now: NOW,
    understand: async () => {
      throw new Error("the model must not read a contact command");
    },
    reply: async (message) => {
      if ("body" in message) replies.push(message);
    },
  };
  return { db, deps, sent, replies };
}

function reload(memory: PracMemory) {
  const next = readPracMemory(writePracMemory({}, memory), NOW.getTime());
  for (const key of Object.keys(memory)) delete (memory as Record<string, unknown>)[key];
  Object.assign(memory, next);
}

const asAdmin = (db: ReturnType<typeof fakeDb>) =>
  db as unknown as Parameters<typeof handlePractitionerMessage>[0];

async function say(
  db: ReturnType<typeof fakeDb>,
  deps: PractitionerDeps,
  memory: PracMemory,
  msg: { text: string; replyId: string | null },
) {
  await handlePractitionerMessage(asAdmin(db), JUSTIN, msg, deps, memory);
  reload(memory);
}

afterEach(() => {
  delete process.env.WHATSAPP_CONTACT_INTRO_TEMPLATE;
  delete process.env.WHATSAPP_CONTACT_INTRO_TEMPLATE_LANG;
});

describe("reading a contact command", () => {
  it("normalises a local South African number to +27 and keeps an explicit country code", () => {
    expect(normaliseContactPhone("082 123 4567")).toBe("+27821234567");
    expect(normaliseContactPhone("0821234567")).toBe("+27821234567");
    expect(normaliseContactPhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normaliseContactPhone("27821234567")).toBe("+27821234567");
    expect(normaliseContactPhone("82 123 4567")).toBe("+27821234567");
    expect(normaliseContactPhone("+1 415 555 1234")).toBe("+14155551234");
    expect(normaliseContactPhone("123")).toBeNull();
  });

  it("reads the message command and the promote command", () => {
    expect(readContactMessage("message Sarah on 082 123 4567: Please call the practice")).toEqual({
      name: "Sarah",
      phone: "+27821234567",
      text: "Please call the practice",
    });
    expect(readContactMessage("text Sarah Jones at +27 82 123 4567 saying the scan is in")).toEqual(
      {
        name: "Sarah Jones",
        phone: "+27821234567",
        text: "the scan is in",
      },
    );
    expect(readContactMessage("tell Sarah well done")).toBeNull();
    expect(readContactMessage("message Sarah saying hello")).toBeNull();
    expect(readPromoteContact("promote Sarah to patient")).toEqual({ name: "Sarah", phone: null });
    expect(readPromoteContact("promote Sarah on 082 123 4567 to a patient")).toEqual({
      name: "Sarah",
      phone: "+27821234567",
    });
  });

  it("locks the Meta template spec", () => {
    expect(CONTACT_INTRO_TEMPLATE).toMatchObject({
      name: "buddy_contact_intro",
      env: "WHATSAPP_CONTACT_INTRO_TEMPLATE",
      category: "UTILITY",
      language: "en",
      header: null,
      footer: null,
      buttons: [{ type: "QUICK_REPLY", text: "See message", payload: "contact_intro" }],
    });
    expect(CONTACT_INTRO_TEMPLATE.body).toContain("{{1}}");
    expect(CONTACT_INTRO_TEMPLATE.body).toContain("{{2}}");
    expect(CONTACT_INTRO_TEMPLATE.variables.map((v) => v.meaning)).toEqual([
      "contact name",
      "practitioner name",
    ]);
    expect(CONTACT_OPT_OUT).not.toMatch(/START|check-in/i);
  });
});

describe("messaging a contact", () => {
  it("shows the exact words and sends nothing until Yes", async () => {
    const { db, deps, sent, replies } = harness();
    db.t.whatsapp_inbound.push({ from_phone: PHONE, received_at: NOW.toISOString() });
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    expect(sent).toHaveLength(0);
    expect(db.t.whatsapp_contacts).toHaveLength(0);
    expect(db.t.clients.map((c) => c.full_name)).toEqual(["Cayla Rosenblatt"]);
    expect(replies[0]?.body).toBe(contactPreview("Sarah", PHONE, "Please call the practice", null));
    expect(replies[0]?.buttons?.map((b) => b.id)).toEqual([
      "prac_ag_yes",
      "prac_ag_edit",
      "prac_ag_no",
    ]);
    expect(memory.pending && memory.pending.kind === "outbound" && memory.pending.preview).toBe(
      "Please call the practice",
    );

    await say(db, deps, memory, { text: "", replyId: "prac_ag_no" });
    expect(sent).toHaveLength(0);
    expect(db.t.whatsapp_contacts).toHaveLength(0);
    expect(replies.at(-1)?.body).toBe("Okay, I won't.");
  });

  it("Edit replaces the text, and Yes inside the window sends that text", async () => {
    const { db, deps, sent, replies } = harness();
    db.t.whatsapp_inbound.push({
      from_phone: PHONE,
      received_at: NOW.toISOString(),
    });
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    await say(db, deps, memory, { text: "", replyId: "prac_ag_edit" });
    expect(replies.at(-1)?.body).toBe("What should I say instead?");
    await say(db, deps, memory, { text: "The appointment is at 3", replyId: null });
    expect(replies.at(-1)?.body).toContain("The appointment is at 3");
    expect(replies.at(-1)?.body).not.toContain("Please call the practice");
    expect(replies.at(-1)?.body).toBe(
      contactPreview("Sarah", PHONE, "The appointment is at 3", null),
    );

    await say(db, deps, memory, { text: "", replyId: "prac_ag_yes" });
    expect(replies.at(-1)?.body).toContain(
      'Sent to Sarah (+27821234567): "The appointment is at 3"',
    );
    const text = sent.find((m) => m.kind === "text");
    expect(text).toMatchObject({ kind: "text", to: DIGITS, body: "The appointment is at 3" });
    expect(sent.some((m) => m.kind === "template")).toBe(false);
    expect(db.t.whatsapp_outbound.map((r) => r.body)).toContain("The appointment is at 3");
    expect(db.t.whatsapp_contacts).toMatchObject([
      { name: "Sarah", phone: PHONE, created_by: "justin", opted_out: false },
    ]);
    expect(db.t.clients.map((c) => c.full_name)).toEqual(["Cayla Rosenblatt"]);
    expect(db.t.check_ins).toHaveLength(0);
  });

  it("a number that already belongs to a patient uses the patient confirm", async () => {
    const { db, deps, sent, replies } = harness();
    db.t.clients.push({
      id: SARAH_PATIENT,
      full_name: "Sarah Patient",
      practitioner_id: "justin",
      practice_id: "pm",
      phone: "082 123 4567",
      created_at: "2026-09-01T00:00:00Z",
    });
    db.t.whatsapp_conversations.push({
      id: "conv-sarah",
      phone: DIGITS,
      client_id: SARAH_PATIENT,
      state: "idle",
      opted_out_at: null,
    });
    db.t.whatsapp_inbound.push({ from_phone: PHONE, received_at: NOW.toISOString() });
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    expect(db.t.whatsapp_contacts).toHaveLength(0);
    expect(replies[0]?.body).toBe(MESSAGE_MSG.confirm("Sarah Patient", "Please call the practice"));
    const send = replies[0]?.buttons?.find((b) => b.title === "Send");
    expect(send?.id).toMatch(/^pq_pick_/);
    await say(db, deps, memory, { text: "", replyId: send?.id ?? "" });
    const text = sent.find((m) => m.kind === "text");
    expect(text && text.kind === "text" ? text.body : "").toContain("a message from Justin");
    expect(text && text.kind === "text" ? text.body : "").toContain("Please call the practice");
    expect(db.t.whatsapp_contacts).toHaveLength(0);
  });

  it("outside the window queues the wording behind the intro template", async () => {
    process.env.WHATSAPP_CONTACT_INTRO_TEMPLATE = "buddy_contact_intro";
    const { db, deps, sent, replies } = harness();
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    expect(replies.at(-1)?.body).toMatch(/queue this message/);
    await say(db, deps, memory, { text: "", replyId: "prac_ag_yes" });
    expect(replies.at(-1)?.body).toContain("Please call the practice");
    expect(sent).toEqual([
      expect.objectContaining({
        kind: "template",
        to: DIGITS,
        templateName: "buddy_contact_intro",
        variables: ["Sarah", "Justin"],
        buttonPayloads: ["contact_intro"],
      }),
    ]);
    expect(JSON.stringify(sent)).not.toContain("Please call the practice");
    expect(db.t.whatsapp_conversations[0]?.draft).toMatchObject({
      pendingContactMessage: "Please call the practice",
    });
    expect(String(db.t.whatsapp_outbound[0]?.body)).toContain("Please call the practice");
    expect(db.t.clients).toHaveLength(1);
  });

  it("tells the practitioner and sends nothing when the template is not configured", async () => {
    const { db, deps, sent, replies } = harness();
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    expect(sent).toHaveLength(0);
    expect(replies[0]?.body).toBe(contactTemplateMissing("Sarah"));
    expect(replies[0]?.body).toMatch(/isn't configured/);
    expect(db.t.whatsapp_contacts).toHaveLength(0);
    expect(db.t.whatsapp_outbound ?? []).toHaveLength(0);
    expect(memory.pending ?? null).toBeNull();
  });

  it("refuses a contact who has opted out", async () => {
    const { db, deps, sent, replies } = harness();
    db.t.whatsapp_inbound.push({ from_phone: PHONE, received_at: NOW.toISOString() });
    db.t.whatsapp_contacts.push({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Sarah",
      phone: PHONE,
      created_by: "justin",
      opted_out: true,
      opted_out_at: "2026-10-01T00:00:00.000Z",
      promoted_client_id: null,
    });
    const memory: PracMemory = {};
    await say(db, deps, memory, {
      text: "message Sarah on 082 123 4567: Please call the practice",
      replyId: null,
    });
    expect(sent).toHaveLength(0);
    expect(replies[0]?.body).toMatch(/stop messaging/i);
    expect(db.t.whatsapp_outbound ?? []).toHaveLength(0);

    await say(db, deps, memory, { text: "promote Sarah to patient", replyId: null });
    expect(sent).toHaveLength(0);
    expect(replies.at(-1)?.body).toMatch(/haven't added them/i);
    expect(db.t.clients.map((c) => c.full_name)).not.toContain("Sarah");
  });

  it("promote adds a patient and sends consent, and the contact stays off the roster until then", async () => {
    const { db, deps, sent, replies } = harness();
    db.t.whatsapp_inbound.push({ from_phone: PHONE, received_at: NOW.toISOString() });
    db.t.whatsapp_contacts.push({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Sarah",
      phone: PHONE,
      created_by: "justin",
      opted_out: false,
      promoted_client_id: null,
    });
    const memory: PracMemory = {};
    await say(db, deps, memory, { text: "list clients", replyId: null });
    expect(replies.at(-1)?.body).toContain("Cayla Rosenblatt");
    expect(replies.at(-1)?.body).not.toContain("Sarah");
    expect(db.t.clients).toHaveLength(1);

    await say(db, deps, memory, { text: "promote Sarah to patient", replyId: null });
    expect(sent).toHaveLength(0);
    expect(replies.at(-1)?.body).toContain("Promote Sarah");
    expect(replies.at(-1)?.body).toContain("won't get check-ins");
    await say(db, deps, memory, { text: "", replyId: "prac_ag_yes" });

    expect(db.t.clients.map((c) => c.full_name).sort()).toEqual(["Cayla Rosenblatt", "Sarah"]);
    const sarah = db.t.clients.find((c) => c.full_name === "Sarah");
    expect(sarah).toMatchObject({
      phone: PHONE,
      phone_e164: DIGITS,
      practitioner_id: "justin",
      practice_id: "pm",
      onboarding_source: "whatsapp_contact",
      popia_accepted: false,
    });
    expect(db.t.whatsapp_contacts[0]?.promoted_client_id).toBe(sarah?.id);
    expect(db.t.check_ins).toHaveLength(0);
    const consent = sent.find((m) => m.kind === "text");
    expect(consent && consent.kind === "text" ? consent.body : "").toMatch(/consent/i);
    expect(String(db.t.whatsapp_outbound.at(-1)?.body)).toMatch(/consent/i);

    await say(db, deps, memory, { text: "list clients", replyId: null });
    expect(replies.at(-1)?.body).toContain("Sarah");
    expect(replies.at(-1)?.body).toContain("2 on Buddy");
  });
});
