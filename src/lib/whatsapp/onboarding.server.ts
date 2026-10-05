import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { currentConsent, renderConsentText, type ConsentType } from "@/lib/consent/wording";
import {
  APP_ORIGIN,
  chatToBuddyLink,
  consentPageUrl,
  newInviteCode,
  type PractitionerOption,
} from "./onboarding";
import { maskPhone } from "./phone";

/**
 * The writes behind WhatsApp onboarding: invite codes, consent links, self
 * sign-up profiles and app accounts. Everything here runs with the service
 * role; callers are the worker (already trusted) and server functions that
 * check who is asking before they call in.
 */

type Admin = SupabaseClient;

const CONSENT_LINK_DAYS = 7;
const CLIENT_INVITE_DAYS = 14;

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

export const REQUIRED_CONSENTS: ConsentType[] = ["popia_core", "whatsapp_checkins"];

/** Current, unwithdrawn records of the CURRENT wording version, by type. */
export async function currentConsentTypes(
  admin: Admin,
  clientId: string,
): Promise<Set<ConsentType>> {
  const { data } = await admin
    .from("consent_records")
    .select("consent_type, version")
    .eq("client_id", clientId)
    .is("withdrawn_at", null)
    .is("superseded_by", null);
  const out = new Set<ConsentType>();
  for (const r of (data ?? []) as Array<{ consent_type: ConsentType; version: string }>) {
    if (
      REQUIRED_CONSENTS.includes(r.consent_type) &&
      r.version === currentConsent(r.consent_type).version
    ) {
      out.add(r.consent_type);
    }
  }
  return out;
}

/** A personal, single-use link to the consent page. Null if it can't be made. */
export async function mintConsentLink(
  admin: Admin,
  clientId: string,
  phone: string | null,
): Promise<string | null> {
  const token = randomToken();
  const { error } = await admin.from("consent_links").insert({
    token_hash: await sha256Hex(token),
    client_id: clientId,
    phone,
    expires_at: new Date(Date.now() + CONSENT_LINK_DAYS * 86_400_000).toISOString(),
  });
  if (error) {
    log.warn("consent link not minted", { code: error.code });
    return null;
  }
  return consentPageUrl(token);
}

export interface ConsentLinkInfo {
  linkId: string;
  clientId: string;
  phone: string | null;
  firstName: string;
  practiceName: string;
  alreadySigned: ConsentType[];
  aiConsent: boolean;
}

export async function readConsentLink(
  admin: Admin,
  token: string,
): Promise<
  { ok: true; info: ConsentLinkInfo } | { ok: false; reason: "invalid" | "expired" | "used" }
> {
  if (!token || token.length < 20 || token.length > 100) return { ok: false, reason: "invalid" };
  const { data: link } = await admin
    .from("consent_links")
    .select("id, client_id, phone, expires_at, used_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  const l = link as {
    id: string;
    client_id: string;
    phone: string | null;
    expires_at: string;
    used_at: string | null;
  } | null;
  if (!l) return { ok: false, reason: "invalid" };
  if (l.used_at) return { ok: false, reason: "used" };
  if (new Date(l.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  const { data: client } = await admin
    .from("clients")
    .select("id, full_name, practice_id, yves_ai_consent")
    .eq("id", l.client_id)
    .maybeSingle();
  const c = client as {
    id: string;
    full_name: string | null;
    practice_id: string | null;
    yves_ai_consent: boolean | null;
  } | null;
  if (!c) return { ok: false, reason: "invalid" };

  return {
    ok: true,
    info: {
      linkId: l.id,
      clientId: c.id,
      phone: l.phone,
      firstName: (c.full_name ?? "").trim().split(/\s+/)[0] || "there",
      practiceName: await practiceName(admin, c.practice_id),
      alreadySigned: [...(await currentConsentTypes(admin, c.id))],
      aiConsent: c.yves_ai_consent === true,
    },
  };
}

/**
 * Record the consents signed on the page. Claims the link first so a double
 * tap can't record twice. Returns the info needed to carry on in WhatsApp.
 */
export async function acceptConsentLink(
  admin: Admin,
  token: string,
  opts: { aiConsent: boolean; userAgent?: string },
): Promise<{ ok: true; info: ConsentLinkInfo } | { ok: false; reason: string }> {
  const read = await readConsentLink(admin, token);
  if (!read.ok) return read;
  const { info } = read;

  const { data: claimed } = await admin
    .from("consent_links")
    .update({ used_at: new Date().toISOString() })
    .eq("id", info.linkId)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, reason: "used" };

  const now = new Date().toISOString();
  for (const type of REQUIRED_CONSENTS) {
    if (info.alreadySigned.includes(type)) continue;
    const v = currentConsent(type);
    const { data: inserted, error } = await admin
      .from("consent_records")
      .insert({
        client_id: info.clientId,
        consent_type: type,
        version: v.version,
        wording_snapshot: renderConsentText(v),
        channel: "whatsapp",
        evidence: {
          via: "consent_page",
          consent_link_id: info.linkId,
          ...(opts.userAgent ? { userAgent: opts.userAgent.slice(0, 300) } : {}),
        },
      })
      .select("id")
      .single();
    if (error) {
      // Release the link so they can try again.
      await admin.from("consent_links").update({ used_at: null }).eq("id", info.linkId);
      return { ok: false, reason: "save_failed" };
    }
    // Older versions of the same consent stop reading as current.
    const newId = (inserted as { id: string }).id;
    await admin
      .from("consent_records")
      .update({ superseded_by: newId })
      .eq("client_id", info.clientId)
      .eq("consent_type", type)
      .is("withdrawn_at", null)
      .is("superseded_by", null)
      .neq("id", newId);
  }

  await admin
    .from("clients")
    .update({
      popia_accepted: true,
      popia_accepted_at: now,
      ...(opts.aiConsent ? { yves_ai_consent: true, yves_ai_consent_at: now } : {}),
    })
    .eq("id", info.clientId);

  return {
    ok: true,
    info: {
      ...info,
      alreadySigned: [...REQUIRED_CONSENTS],
      aiConsent: info.aiConsent || opts.aiConsent,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

export interface InviteRow {
  id: string;
  code: string;
  kind: "client" | "practice";
  practice_id: string | null;
  practitioner_id: string | null;
  client_id: string | null;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
}

export async function findInvite(admin: Admin, code: string): Promise<InviteRow | null> {
  const { data, error } = await admin
    .from("whatsapp_invites")
    .select(
      "id, code, kind, practice_id, practitioner_id, client_id, expires_at, used_at, revoked_at",
    )
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) log.warn("invite lookup failed", { code: error.code, message: error.message });
  const inv = data as InviteRow | null;
  if (!inv) {
    log.info("invite not found", { length: code.length });
    return null;
  }
  if (inv.revoked_at) {
    log.info("invite revoked", { id: inv.id });
    return null;
  }
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    log.info("invite expired", { id: inv.id });
    return null;
  }
  return inv;
}

async function insertInvite(
  admin: Admin,
  row: Omit<InviteRow, "id" | "code" | "used_at" | "revoked_at"> & { created_by: string | null },
): Promise<InviteRow | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin
      .from("whatsapp_invites")
      .insert({ ...row, code: newInviteCode() })
      .select(
        "id, code, kind, practice_id, practitioner_id, client_id, expires_at, used_at, revoked_at",
      )
      .single();
    if (!error && data) return data as InviteRow;
    if (error && error.code !== "23505") {
      log.warn("invite insert failed", { code: error.code });
      return null;
    }
  }
  return null;
}

/** A one-patient link. Reuses a live unused invite so the link stays stable. */
export async function clientInviteLink(
  admin: Admin,
  clientId: string,
  createdBy: string,
): Promise<{ code: string; link: string } | null> {
  const { data: existing } = await admin
    .from("whatsapp_invites")
    .select("code, expires_at")
    .eq("kind", "client")
    .eq("client_id", clientId)
    .is("used_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const live = ((existing ?? []) as Array<{ code: string; expires_at: string | null }>).find(
    (r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now() + 86_400_000,
  );
  if (live) return { code: live.code, link: chatToBuddyLink(live.code, "client") };

  const { data: client } = await admin
    .from("clients")
    .select("practitioner_id, practice_id")
    .eq("id", clientId)
    .maybeSingle();
  const c = client as { practitioner_id: string; practice_id: string | null } | null;
  if (!c) return null;
  const inv = await insertInvite(admin, {
    kind: "client",
    client_id: clientId,
    practitioner_id: c.practitioner_id,
    practice_id: c.practice_id,
    expires_at: new Date(Date.now() + CLIENT_INVITE_DAYS * 86_400_000).toISOString(),
    created_by: createdBy,
  });
  return inv ? { code: inv.code, link: chatToBuddyLink(inv.code, "client") } : null;
}

/** The practice's standing link for posters, QR codes and the website. */
export async function practiceInviteLink(
  admin: Admin,
  practiceId: string,
  createdBy: string,
): Promise<{ code: string; link: string } | null> {
  const { data: existing } = await admin
    .from("whatsapp_invites")
    .select("code")
    .eq("kind", "practice")
    .eq("practice_id", practiceId)
    .is("revoked_at", null)
    .limit(1);
  const live = (existing ?? [])[0] as { code: string } | undefined;
  if (live) return { code: live.code, link: chatToBuddyLink(live.code, "practice") };
  const inv = await insertInvite(admin, {
    kind: "practice",
    practice_id: practiceId,
    practitioner_id: null,
    client_id: null,
    expires_at: null,
    created_by: createdBy,
  });
  return inv ? { code: inv.code, link: chatToBuddyLink(inv.code, "practice") } : null;
}

/* ------------------------------------------------------------------ */
/* Practice and practitioners                                          */
/* ------------------------------------------------------------------ */

export async function practiceName(admin: Admin, practiceId: string | null): Promise<string> {
  if (!practiceId) return "your practice";
  const { data } = await admin
    .from("practices")
    .select("practice_name")
    .eq("id", practiceId)
    .maybeSingle();
  return (
    ((data as { practice_name?: string | null } | null)?.practice_name ?? "").trim() ||
    "your practice"
  );
}

export async function practiceRoster(
  admin: Admin,
  practiceId: string,
): Promise<{
  practiceName: string;
  practitioners: PractitionerOption[];
  fallback: PractitionerOption;
} | null> {
  const { data: practice } = await admin
    .from("practices")
    .select("id, practice_name, practitioner_id")
    .eq("id", practiceId)
    .maybeSingle();
  const p = practice as {
    id: string;
    practice_name: string | null;
    practitioner_id: string;
  } | null;
  if (!p) return null;
  const { data: members } = await admin
    .from("practice_members")
    .select("user_id")
    .eq("practice_id", practiceId)
    .eq("status", "active");
  const ids = [
    ...new Set([
      p.practitioner_id,
      ...((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
    ]),
  ];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", ids);
  const names = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((r) => [
      r.id,
      r.full_name ?? "",
    ]),
  );
  const practitioners = ids
    .map((id) => ({ id, name: (names.get(id) || "").trim() }))
    .filter((o) => o.name);
  const owner = practitioners.find((o) => o.id === p.practitioner_id) ?? {
    id: p.practitioner_id,
    name: "the practice",
  };
  return {
    practiceName: (p.practice_name ?? "").trim() || "your practice",
    practitioners,
    fallback: owner,
  };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export async function createSelfSignupClient(
  admin: Admin,
  input: { fullName: string; practitionerId: string; practiceId: string; phone: string },
): Promise<string> {
  const { data, error } = await admin
    .from("clients")
    .insert({
      practitioner_id: input.practitionerId,
      practice_id: input.practiceId,
      full_name: input.fullName,
      phone: `+${input.phone}`,
      popia_accepted: false,
      login_code: String(Math.floor(1000 + Math.random() * 9000)),
      timezone: "Africa/Johannesburg",
      onboarding_source: "whatsapp_self",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`self sign-up insert failed: ${error?.code ?? "unknown"}`);
  log.info("whatsapp self sign-up", { from: maskPhone(input.phone) });
  return (data as { id: string }).id;
}

/**
 * Give a WhatsApp-only patient a Buddy app login. Same path as a practitioner
 * adding a client: an auth user with a random password, then the welcome
 * email with a set-password link. Never takes over an existing account.
 */
export async function setupAppAccount(
  admin: Admin,
  client: { id: string; full_name: string | null; practitioner_id: string },
  email: string,
): Promise<"ok" | "taken" | "error"> {
  const { data: other } = await admin.from("clients").select("id").ilike("email", email).limit(1);
  if ((other ?? []).some((r) => (r as { id: string }).id !== client.id)) return "taken";

  const authAdmin = (
    admin as unknown as {
      auth: {
        admin: {
          createUser: (a: { email: string; password: string; email_confirm: boolean }) => Promise<{
            data: { user: { id: string } | null };
            error: { message: string } | null;
          }>;
          generateLink: (a: {
            type: "recovery";
            email: string;
            options?: { redirectTo?: string };
          }) => Promise<{
            data: { properties?: { action_link?: string } } | null;
            error: unknown;
          }>;
        };
      };
    }
  ).auth.admin;

  const password = randomToken();
  const { data: created, error } = await authAdmin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created.user) {
    return /already|registered|exists/i.test(error?.message ?? "") ? "taken" : "error";
  }
  const { error: linkErr } = await admin
    .from("clients")
    .update({ auth_user_id: created.user.id, email })
    .eq("id", client.id);
  if (linkErr) return "error";

  try {
    const { passwordResetRedirectUrl } = await import("@/lib/app-url");
    const { data: link } = await authAdmin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: passwordResetRedirectUrl() },
    });
    const { data: practitioner } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", client.practitioner_id)
      .maybeSingle();
    const { sendTransactionalEmailServer } = await import("@/lib/email/send-server");
    await sendTransactionalEmailServer({
      templateName: "client-welcome",
      recipientEmail: email,
      idempotencyKey: `client-welcome-${client.id}`,
      templateData: {
        clientName: client.full_name,
        practitionerName: (practitioner as { full_name?: string } | null)?.full_name ?? null,
        email,
        loginUrl: `${APP_ORIGIN}/client/login`,
        setPasswordUrl: link?.properties?.action_link ?? null,
      },
    });
  } catch (e) {
    log.warn("whatsapp app account email failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
  }
  return "ok";
}
