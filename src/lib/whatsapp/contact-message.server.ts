/**
 * Sending and receiving for whatsapp_contacts.
 *
 * A contact is not a patient. Nothing here starts a check-in, writes a
 * report, or inserts a client until promote. Inbound text is relayed to the
 * practitioner who added the number. AI is not called. Red-flag rules still
 * run, and a hit gets the standard emergency reply plus a practitioner alert.
 *
 * Outside the 24 hour window the approved intro template is sent and the
 * confirmed wording waits on the conversation draft until they reply. A red
 * flag on that reply holds the wording. STOP sets opted_out and blocks every
 * later send.
 */
import { log } from "@/lib/log";
import { classifyIntent } from "./intent";
import { maskPhone, matchPhone, samePhone } from "./phone";
import { safetyReply } from "./conversation";
import { runRedFlagRules } from "./red-flag-rules";
import {
  CONTACT_INTRO_TEMPLATE_ENV,
  CONTACT_OPT_OUT,
  PENDING_CONTACT_MESSAGE,
  contactDigits,
  contactDisplayName,
  contactOptedOut,
  contactQueued,
  contactSent,
  contactTemplateMissing,
  normaliseContactPhone,
  templateVariable,
} from "./contact-message";
import type { ProviderSecrets, WhatsAppProvider } from "./provider";

type WriteResult = { data?: unknown; error?: { message?: string; code?: string } | null };

interface Query extends Promise<WriteResult> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  limit(count: number): Query;
  update(patch: Record<string, unknown>): Query;
  insert(row: Record<string, unknown>): Query | Promise<WriteResult>;
}

type Admin = { from: (table: string) => Query };
type SendEnv = { provider: WhatsAppProvider; secrets: ProviderSecrets };

export interface WhatsAppContact {
  id: string;
  name: string;
  phone: string;
  created_by: string;
  opted_out: boolean;
  opted_out_at: string | null;
  promoted_client_id: string | null;
}

export interface PatientPhoneHit {
  id: string;
  full_name: string | null;
}

function asRows<T>(data: unknown): T[] {
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]) as T[];
}

/** A client already uses this number. Contacts must not take over that chat. */
export async function lookupPatientByPhone(
  adminIn: unknown,
  phone: string,
): Promise<PatientPhoneHit | null> {
  const admin = adminIn as Admin;
  const target = normaliseContactPhone(phone);
  if (!target) return null;
  let res = await admin.from("clients").select("id, full_name, phone, phone_e164").limit(5000);
  if (res?.error) {
    res = await admin.from("clients").select("id, full_name, phone").limit(5000);
  }
  if (res?.error) return null;
  const rows = asRows<{
    id: string;
    full_name: string | null;
    phone: string | null;
    phone_e164?: string | null;
  }>(res.data);
  const hit =
    rows.find((row) => samePhone(row.phone, target) || samePhone(row.phone_e164 ?? null, target)) ??
    null;
  return hit ? { id: hit.id, full_name: hit.full_name } : null;
}

async function listContacts(admin: Admin): Promise<WhatsAppContact[]> {
  const res = await admin
    .from("whatsapp_contacts")
    .select("id, name, phone, created_by, opted_out, opted_out_at, promoted_client_id")
    .limit(2000);
  if (res?.error) return [];
  return asRows<WhatsAppContact>(res.data).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? "").trim(),
    phone: String(row.phone ?? ""),
    created_by: String(row.created_by ?? ""),
    opted_out: row.opted_out === true,
    opted_out_at: row.opted_out_at ?? null,
    promoted_client_id: row.promoted_client_id ?? null,
  }));
}

export async function findContactByPhone(
  adminIn: unknown,
  phone: string,
): Promise<WhatsAppContact | null> {
  const target = normaliseContactPhone(phone);
  if (!target) return null;
  const rows = await listContacts(adminIn as Admin);
  return rows.find((row) => !row.promoted_client_id && samePhone(row.phone, target)) ?? null;
}

export async function prepareContact(
  adminIn: unknown,
  args: { name: string; phone: string; practitionerId: string },
): Promise<
  | { kind: "opted_out"; name: string; phone: string }
  | { kind: "ready"; id: string; name: string; phone: string; createdBy: string }
> {
  const phone = normaliseContactPhone(args.phone);
  if (!phone) return { kind: "opted_out", name: args.name, phone: args.phone };
  const existing = await findContactByPhone(adminIn, phone);
  if (existing?.opted_out) return { kind: "opted_out", name: existing.name || args.name, phone };
  if (existing) {
    return {
      kind: "ready",
      id: existing.id,
      name: args.name || existing.name,
      phone,
      createdBy: existing.created_by,
    };
  }
  return {
    kind: "ready",
    id: crypto.randomUUID(),
    name: args.name,
    phone,
    createdBy: args.practitionerId,
  };
}

async function saveContact(
  admin: Admin,
  row: { id: string; name: string; phone: string; createdBy: string; now: Date },
): Promise<WhatsAppContact | null> {
  const existing = await findContactByPhone(admin, row.phone);
  if (existing?.opted_out) return existing;
  if (existing) {
    if (existing.name !== row.name) {
      await admin
        .from("whatsapp_contacts")
        .update({ name: row.name, updated_at: row.now.toISOString() })
        .eq("id", existing.id);
      existing.name = row.name;
    }
    return existing;
  }
  const created: WhatsAppContact = {
    id: row.id,
    name: row.name,
    phone: row.phone,
    created_by: row.createdBy,
    opted_out: false,
    opted_out_at: null,
    promoted_client_id: null,
  };
  const res = await admin.from("whatsapp_contacts").insert({
    ...created,
    created_at: row.now.toISOString(),
    updated_at: row.now.toISOString(),
  });
  if (res?.error) return findContactByPhone(admin, row.phone);
  return created;
}

async function conversationOf(
  admin: Admin,
  digits: string,
): Promise<{ id: string; draft: Record<string, unknown>; state: string } | null> {
  const res = await admin
    .from("whatsapp_conversations")
    .select("id, draft, state")
    .eq("phone", digits)
    .limit(1);
  const row = asRows<{ id: string; draft: unknown; state: string }>(res?.data)[0];
  if (!row?.id) return null;
  const draft =
    row.draft && typeof row.draft === "object" ? { ...(row.draft as Record<string, unknown>) } : {};
  return { id: row.id, draft, state: row.state };
}

async function ensureConversation(
  admin: Admin,
  digits: string,
): Promise<{
  id: string;
  draft: Record<string, unknown>;
  state: string;
} | null> {
  const existing = await conversationOf(admin, digits);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const res = await admin.from("whatsapp_conversations").insert({
    id,
    phone: digits,
    state: "idle",
    draft: {},
    client_id: null,
  });
  if (res?.error) return conversationOf(admin, digits);
  return { id, draft: {}, state: "idle" };
}

async function writeDraft(
  admin: Admin,
  id: string,
  draft: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("whatsapp_conversations")
    .update({ draft, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
}

function introTemplate(): { name: string; language: string } | null {
  const name = process.env[CONTACT_INTRO_TEMPLATE_ENV]?.trim();
  if (!name) return null;
  return {
    name,
    language: process.env.WHATSAPP_CONTACT_INTRO_TEMPLATE_LANG?.trim() || "en",
  };
}

export async function sendContactMessage(
  adminIn: unknown,
  env: SendEnv,
  args: {
    id: string;
    name: string;
    phone: string;
    text: string;
    practitionerId: string;
    practitionerName: string;
    now: Date;
  },
): Promise<{ reply: string; sent: boolean; queued: boolean }> {
  const admin = adminIn as Admin;
  const phone = normaliseContactPhone(args.phone);
  const digits = phone ? contactDigits(phone) : null;
  const text = args.text.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!phone || !digits || !text) {
    return {
      reply: "That didn't look like a message I can send, so I didn't send anything.",
      sent: false,
      queued: false,
    };
  }
  const patient = await lookupPatientByPhone(admin, phone);
  if (patient) {
    return {
      reply: `${patient.full_name ?? "That number"} is already a patient, so I didn't send this as a contact message.`,
      sent: false,
      queued: false,
    };
  }
  const existing = await findContactByPhone(admin, phone);
  if (existing?.opted_out) {
    return { reply: contactOptedOut(existing.name || args.name), sent: false, queued: false };
  }
  const { windowOpen, sendLogged } = await import("./practitioner-status.server");
  const open = await windowOpen(adminIn as never, digits, args.now);
  const template = introTemplate();
  if (!open && !template) {
    return { reply: contactTemplateMissing(args.name), sent: false, queued: false };
  }
  const saved = await saveContact(admin, {
    id: args.id,
    name: args.name,
    phone,
    createdBy: existing?.created_by || args.practitionerId,
    now: args.now,
  });
  if (!saved || saved.opted_out) {
    return { reply: contactOptedOut(args.name), sent: false, queued: false };
  }
  const ownerNote =
    saved.created_by && saved.created_by !== args.practitionerId
      ? " Replies go to the practitioner who added this number."
      : "";

  if (open) {
    const ok = await sendLogged(
      adminIn as never,
      env,
      { kind: "text", to: digits, body: text },
      text,
    );
    log.info("contact message", { queued: false, sent: ok });
    return {
      reply: ok
        ? `${contactSent(saved.name, phone, text)}${ownerNote}`
        : `Sorry, that didn't send to ${saved.name}. Nothing else was sent.`,
      sent: ok,
      queued: false,
    };
  }

  const conv = await ensureConversation(admin, digits);
  if (!conv || !template) {
    return { reply: contactTemplateMissing(saved.name), sent: false, queued: false };
  }
  conv.draft[PENDING_CONTACT_MESSAGE] = text;
  await writeDraft(admin, conv.id, conv.draft, {});
  const ok = await sendLogged(
    adminIn as never,
    env,
    {
      kind: "template",
      to: digits,
      templateName: template.name,
      languageCode: template.language,
      variables: [
        templateVariable(contactDisplayName(saved.name), "there"),
        templateVariable(args.practitionerName, "your practitioner"),
      ],
      buttonPayloads: ["contact_intro"],
    },
    `[contact intro ${template.name}] ${text}`,
  );
  if (!ok) {
    delete conv.draft[PENDING_CONTACT_MESSAGE];
    await writeDraft(admin, conv.id, conv.draft, {});
    log.info("contact message", { queued: false, sent: false });
    return {
      reply: `Sorry, that didn't send to ${saved.name}. Nothing else was sent.`,
      sent: false,
      queued: false,
    };
  }
  log.info("contact message", { queued: true, sent: true });
  return {
    reply: `${contactQueued(saved.name, text)}${ownerNote}`,
    sent: true,
    queued: true,
  };
}

function nameMatches(query: string, name: string): "exact" | "first" | "none" {
  const q = query.toLowerCase().trim();
  const n = name.toLowerCase().trim();
  if (!q || !n) return "none";
  if (n === q) return "exact";
  if (n.split(/\s+/)[0] === q) return "first";
  return "none";
}

export async function findContactsToPromote(
  adminIn: unknown,
  args: { name: string; phone: string | null; practitionerId: string; privileged: boolean },
): Promise<
  | { kind: "none" }
  | { kind: "many"; contacts: WhatsAppContact[] }
  | { kind: "one"; contact: WhatsAppContact }
> {
  const admin = adminIn as Admin;
  let rows = (await listContacts(admin)).filter((row) => !row.promoted_client_id);
  if (!args.privileged) rows = rows.filter((row) => row.created_by === args.practitionerId);
  if (args.phone) {
    const phone = normaliseContactPhone(args.phone);
    rows = rows.filter((row) => phone && samePhone(row.phone, phone));
  }
  const exact = rows.filter((row) => nameMatches(args.name, row.name) === "exact");
  const pool = exact.length
    ? exact
    : rows.filter((row) => nameMatches(args.name, row.name) === "first");
  if (!pool.length) return { kind: "none" };
  if (pool.length > 1) return { kind: "many", contacts: pool };
  return { kind: "one", contact: pool[0] };
}

async function practiceIdFor(admin: Admin, userId: string): Promise<string | null> {
  const owned = await admin.from("practices").select("id").eq("practitioner_id", userId).limit(1);
  const ownedId = asRows<{ id: string }>(owned?.data)[0]?.id;
  if (ownedId) return ownedId;
  const member = await admin
    .from("practice_members")
    .select("practice_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  return asRows<{ practice_id: string }>(member?.data)[0]?.practice_id ?? null;
}

export async function promoteContact(
  adminIn: unknown,
  env: SendEnv,
  args: { contactId: string; practitionerId: string; practitionerName: string; now: Date },
): Promise<{ reply: string; clientId: string | null }> {
  const admin = adminIn as Admin;
  const contact = (await listContacts(admin)).find((row) => row.id === args.contactId) ?? null;
  if (!contact || contact.promoted_client_id) {
    return {
      reply: "I couldn't find that contact, so I didn't add a patient or send anything.",
      clientId: contact?.promoted_client_id ?? null,
    };
  }
  if (contact.opted_out) {
    return {
      reply: `${contact.name} asked not to be messaged, so I haven't added them as a patient or sent anything.`,
      clientId: null,
    };
  }
  const already = await lookupPatientByPhone(admin, contact.phone);
  if (already) {
    await admin
      .from("whatsapp_contacts")
      .update({
        promoted_client_id: already.id,
        updated_at: args.now.toISOString(),
      })
      .eq("id", contact.id);
    return {
      reply: `${already.full_name ?? contact.name} is already a patient, so I linked the contact and didn't send a second consent.`,
      clientId: already.id,
    };
  }
  const clientId = crypto.randomUUID();
  const digits = contactDigits(contact.phone);
  const practiceId = await practiceIdFor(admin, args.practitionerId);
  const inserted = await admin.from("clients").insert({
    id: clientId,
    practitioner_id: args.practitionerId,
    practice_id: practiceId,
    full_name: contact.name,
    phone: contact.phone,
    phone_e164: digits,
    popia_accepted: false,
    login_code: String(Math.floor(1000 + Math.random() * 9000)),
    timezone: "Africa/Johannesburg",
    onboarding_source: "whatsapp_contact",
    created_at: args.now.toISOString(),
  });
  if (inserted?.error) {
    return { reply: `I couldn't add ${contact.name} just now. Nothing was sent.`, clientId: null };
  }
  await admin
    .from("whatsapp_contacts")
    .update({ promoted_client_id: clientId, updated_at: args.now.toISOString() })
    .eq("id", contact.id);

  const conv = digits ? await ensureConversation(admin, digits) : null;
  if (conv && digits) {
    await writeDraft(admin, conv.id, conv.draft, {
      client_id: clientId,
      state: "awaiting_consent",
    });
  }

  const { mintConsentLink } = await import("./onboarding.server");
  const { ONBOARD_MSG } = await import("./onboarding");
  const { windowOpen, sendLogged } = await import("./practitioner-status.server");
  const open = digits ? await windowOpen(adminIn as never, digits, args.now) : false;
  if (!open || !digits) {
    log.info("contact promoted", { consent: "queued_for_reply" });
    return {
      reply: `${contact.name} is now a patient. WhatsApp won't let me send the consent link until they message Buddy, and they'll get it then. No check-in until they sign.`,
      clientId,
    };
  }
  const url = await mintConsentLink(adminIn as never, clientId, digits).catch(() => null);
  if (!url) {
    return {
      reply: `${contact.name} is now a patient. I couldn't open the consent link just now. They'll get it when they next message Buddy. No check-in until they sign.`,
      clientId,
    };
  }
  const body = ONBOARD_MSG.consentLink(contact.name.split(/\s+/)[0] || contact.name, url);
  const ok = await sendLogged(adminIn as never, env, { kind: "text", to: digits, body }, body);
  log.info("contact promoted", { consent: ok ? "sent" : "failed" });
  return {
    reply: ok
      ? `${contact.name} is now a patient. I sent the usual consent link. They won't get check-ins until they sign.`
      : `${contact.name} is now a patient. The consent link didn't send. They'll get it when they next message Buddy. No check-in until they sign.`,
    clientId,
  };
}

async function notifyPractitioner(
  admin: Admin,
  env: SendEnv,
  args: {
    practitionerId: string;
    message: string;
    now: Date;
    alertType: string;
    urgency: string;
    category: string | null;
    redFlag: boolean;
  },
): Promise<void> {
  const alertId = crypto.randomUUID();
  await admin.from("alerts").insert({
    id: alertId,
    practitioner_id: args.practitionerId,
    client_id: null,
    alert_type: args.alertType,
    message: args.message.slice(0, 1000),
    urgency: args.urgency,
    red_flag_category: args.category,
    is_read: false,
    push_fired: false,
    email_fired: false,
    whatsapp_fired: false,
    webhook_fired: false,
    created_at: args.now.toISOString(),
  });
  if (args.redFlag) {
    try {
      const { notifyRedFlagAlert } = await import("./worker.server");
      await notifyRedFlagAlert(admin as never, alertId);
    } catch (e) {
      log.warn("contact red flag notify failed", {
        error: e instanceof Error ? e.message : "unknown",
      });
    }
    return;
  }
  let whatsapped = false;
  try {
    const { practitionerContact, windowOpen, sendLogged } =
      await import("./practitioner-status.server");
    const prac = await practitionerContact(admin as never, args.practitionerId);
    if (prac.phone && (await windowOpen(admin as never, prac.phone, args.now))) {
      whatsapped = await sendLogged(
        admin as never,
        env,
        { kind: "text", to: prac.phone, body: args.message },
        args.message,
      );
    }
  } catch {
    whatsapped = false;
  }
  if (whatsapped) return;
  try {
    const { sendPushCore } = await import("@/lib/push.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await sendPushCore(supabaseAdmin, {
      userId: args.practitionerId,
      title: "Buddy",
      body: args.message.slice(0, 180),
      data: { kind: "whatsapp_contact" },
    });
  } catch {
    /* the alert row is the record */
  }
}

/**
 * Inbound from a contact number that is not a patient. Returns true when this
 * number is a contact and must not continue into the patient or AI path.
 */
export async function handleContactInbound(
  adminIn: unknown,
  env: SendEnv,
  args: { phone: string; text: string; now: Date; receivedAt: string },
): Promise<boolean> {
  const admin = adminIn as Admin;
  let contact: WhatsAppContact | null = null;
  try {
    contact = await findContactByPhone(admin, args.phone);
  } catch (e) {
    log.warn("contact lookup failed", {
      error: e instanceof Error ? e.message.slice(0, 120) : "unknown",
    });
    return false;
  }
  if (!contact) return false;

  let patientOwned = false;
  try {
    const res = await admin.from("clients").select("id, phone, phone_e164").limit(5000);
    if (res?.error) return false;
    const rows = asRows<{ id: string; phone: string | null; phone_e164?: string | null }>(res.data);
    const seen = new Set<string>();
    const candidates = rows.flatMap((row) => {
      const out: Array<{ id: string; phone: string | null }> = [];
      for (const value of [row.phone, row.phone_e164 ?? null]) {
        const key = `${row.id}:${value ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: row.id, phone: value });
      }
      return out;
    });
    const match = matchPhone(args.phone, candidates);
    // The same profile stored in two formats is still one patient.
    const distinct =
      match.kind === "ambiguous" ? new Set(match.ids).size : match.kind === "matched" ? 1 : 0;
    patientOwned = distinct > 0;
  } catch {
    patientOwned = true;
  }
  if (patientOwned) return false;

  const text = String(args.text ?? "").trim();
  const flags = runRedFlagRules({
    text,
    isPostOperative: false,
    consecutiveMissedCheckins: 0,
  });
  const optOut = classifyIntent({ text }).intent === "opt_out";
  const digits = contactDigits(contact.phone) ?? contactDigits(args.phone);
  const conv = digits ? await ensureConversation(admin, digits) : null;
  const queued =
    typeof conv?.draft[PENDING_CONTACT_MESSAGE] === "string"
      ? String(conv.draft[PENDING_CONTACT_MESSAGE])
      : "";
  const alreadyOut = contact.opted_out;

  if (optOut && !alreadyOut) {
    await admin
      .from("whatsapp_contacts")
      .update({
        opted_out: true,
        opted_out_at: args.now.toISOString(),
        updated_at: args.now.toISOString(),
      })
      .eq("id", contact.id);
    contact.opted_out = true;
  }

  const deliverQueued = Boolean(queued && !optOut && !alreadyOut && !flags.triggered);
  if (conv) {
    if (deliverQueued || optOut) delete conv.draft[PENDING_CONTACT_MESSAGE];
    await writeDraft(admin, conv.id, conv.draft, {
      last_inbound_at: args.receivedAt,
      state:
        optOut || alreadyOut
          ? "opted_out"
          : conv.state === "new" || conv.state === "unmatched"
            ? "idle"
            : conv.state,
      ...(optOut ? { opted_out_at: args.now.toISOString() } : {}),
    });
  }

  const { sendLogged } = await import("./practitioner-status.server");
  const replies: string[] = [];
  if (flags.triggered) {
    const safety = safetyReply(flags, true);
    if (safety) replies.push(safety);
  }
  if (optOut && !alreadyOut) replies.push(CONTACT_OPT_OUT);
  else if (deliverQueued && queued) replies.push(queued);
  if (digits) {
    for (const body of replies) {
      await sendLogged(adminIn as never, env, { kind: "text", to: digits, body }, body);
    }
  }

  const relay = optOut
    ? `${contact.name} replied STOP. I won't message ${contact.phone} again.`
    : flags.triggered
      ? `${contact.name} messaged Buddy and a red flag fired. I sent the standard emergency advice and did not run AI. Their message: ${text || "(no text)"}`
      : text
        ? `${contact.name} replied: ${text}`
        : `${contact.name} sent a message I couldn't read as text.`;
  await notifyPractitioner(admin, env, {
    practitionerId: contact.created_by,
    message: relay,
    now: args.now,
    alertType: flags.triggered ? "red_flag" : "client_contact_request",
    urgency: flags.triggered ? flags.urgency : "routine",
    category: flags.triggered ? flags.category : null,
    redFlag: flags.triggered,
  }).catch(() => undefined);

  log.info("contact inbound", {
    from: maskPhone(digits),
    optOut,
    redFlag: flags.triggered,
    deliveredQueued: deliverQueued,
    replies: replies.length,
  });
  return true;
}
