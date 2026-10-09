/**
 * Provider boundary for the WhatsApp channel.
 *
 * Buddy must not care whether a message arrived through Meta's Cloud API or
 * through Twilio. Everything above this file works on `InboundMessage` and
 * `OutboundMessage`; everything below it is one small adapter per provider.
 *
 * Why this exists: the Meta number is still pending and the Twilio route is
 * already half set up. Committing to either one now would mean rewriting the
 * webhook, the queue and the send path later. This keeps that decision cheap.
 *
 * Nothing here reads secrets from a module scope. Secrets are passed in by the
 * caller from the Worker env so they never end up in a bundle or a log line.
 */

export type WhatsAppProviderId = "meta" | "twilio";

/** A message from a patient, normalised across providers. */
export interface InboundMessage {
  /** Provider's own message id. Used for idempotency, never shown to anyone. */
  providerMessageId: string;
  /** E.164, no "whatsapp:" prefix, no spaces. The join key to a patient. */
  from: string;
  /** The business number the patient wrote to, E.164. */
  to: string;
  /** When the provider says the patient sent it. */
  sentAt: Date;
  kind: "text" | "interactive" | "media" | "unsupported";
  /** Patient's words for a text message. Empty string for the other kinds. */
  text: string;
  /**
   * Set when the patient tapped a button or picked a list row. The id is ours,
   * from whatever we sent, so this is the reliable path for structured answers.
   */
  reply?: { id: string; title: string };
  /** Present for media. We do not download media in this phase. */
  media?: { id: string; mimeType: string };
  providerId: WhatsAppProviderId;
}

/** A delivery status callback (sent / delivered / read / failed). */
export interface StatusUpdate {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: Date;
  /** Provider error text when status is failed. Operational, not clinical. */
  error?: string;
  providerId: WhatsAppProviderId;
}

export interface WebhookPayload {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

export type OutboundMessage =
  | { kind: "text"; to: string; body: string }
  | {
      kind: "buttons";
      to: string;
      body: string;
      /** WhatsApp allows at most 3. Adapters must reject more, not silently drop. */
      buttons: Array<{ id: string; title: string }>;
    }
  | {
      kind: "list";
      to: string;
      body: string;
      buttonLabel: string;
      /** WhatsApp allows at most 10 rows. */
      rows: Array<{ id: string; title: string; description?: string }>;
    }
  | {
      kind: "template";
      to: string;
      templateName: string;
      languageCode: string;
      /** Positional body variables, in order. */
      variables: string[];
      /** Payloads for the template's quick-reply buttons, in button order. */
      buttonPayloads?: string[];
    };

export interface SendResult {
  providerMessageId: string;
}

/** Raw request as the Worker sees it, handed to the adapter unparsed. */
export interface RawWebhookRequest {
  /** The exact bytes of the body. Signature checks depend on this being untouched. */
  rawBody: string;
  headers: Record<string, string>;
  /** Full URL including query string. Twilio signs this; Meta does not. */
  url: string;
}

export interface ProviderSecrets {
  /** Meta: app secret. Twilio: auth token. Both sign with it. */
  signingSecret: string;
  /** Meta: permanent access token. Twilio: unused (auth token above is reused). */
  accessToken?: string;
  /** Meta: phone number id. Twilio: the "whatsapp:+27..." sender. */
  senderId: string;
  /** Meta only: the token echoed back on the GET verification handshake. */
  verifyToken?: string;
}

export interface WhatsAppProvider {
  readonly id: WhatsAppProviderId;
  /**
   * Returns true only if the request really came from the provider.
   * Must be constant-time against the signature and must never throw on
   * malformed input; a bad signature is a false, not an exception.
   */
  verifySignature(req: RawWebhookRequest, secrets: ProviderSecrets): Promise<boolean>;
  /** Parse a verified request into our shape. Unknown event types are dropped. */
  parseWebhook(req: RawWebhookRequest): WebhookPayload;
  send(message: OutboundMessage, secrets: ProviderSecrets): Promise<SendResult>;
  /**
   * Show the patient their message was read, and a typing indicator while we
   * work on the reply. Cosmetic: callers must ignore failures. Optional, since
   * Twilio has no equivalent.
   */
  markRead?(providerMessageId: string, secrets: ProviderSecrets): Promise<void>;
  /** Download an inbound media item (a voice note). Optional per provider. */
  fetchMedia?(
    mediaId: string,
    secrets: ProviderSecrets,
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 0 || clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Length-independent compare. Returns false for different lengths. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(
  algorithm: "SHA-256" | "SHA-1",
  secret: string,
  body: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return new Uint8Array(sig);
}

function header(req: RawWebhookRequest, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/** Strip "whatsapp:" and any spacing, keep the leading +. */
export function normalisePhone(value: string): string {
  const stripped = value.replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  return stripped.startsWith("+") ? stripped : `+${stripped}`;
}

/* ------------------------------------------------------------------ */
/* Meta Cloud API                                                      */
/* ------------------------------------------------------------------ */

const META_GRAPH_VERSION = "v21.0";

export const metaProvider: WhatsAppProvider = {
  id: "meta",

  async markRead(providerMessageId, secrets) {
    await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${secrets.senderId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.accessToken ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: providerMessageId,
        typing_indicator: { type: "text" },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  },

  async fetchMedia(mediaId, secrets) {
    const auth = { Authorization: `Bearer ${secrets.accessToken ?? ""}` };
    // Two steps: the media id resolves to a short-lived URL, which needs the
    // same token to download.
    const meta = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
      { headers: auth, signal: AbortSignal.timeout(10_000) },
    );
    if (!meta.ok) return null;
    const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!info.url || (info.file_size ?? 0) > 16 * 1024 * 1024) return null;
    const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (!file.ok) return null;
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: info.mime_type ?? file.headers.get("content-type") ?? "audio/ogg",
    };
  },

  async verifySignature(req, secrets) {
    const given = header(req, "x-hub-signature-256");
    if (!given || !given.startsWith("sha256=")) return false;
    const expected = await hmac("SHA-256", secrets.signingSecret, req.rawBody);
    const supplied = hexToBytes(given.slice("sha256=".length));
    if (!supplied) return false;
    return timingSafeEqual(expected, supplied);
  },

  parseWebhook(req) {
    const messages: InboundMessage[] = [];
    const statuses: StatusUpdate[] = [];

    let body: any;
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      return { messages, statuses };
    }

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value) continue;
        const businessNumber = normalisePhone(value?.metadata?.display_phone_number ?? "");

        for (const m of value?.messages ?? []) {
          if (!m?.id || !m?.from) continue;
          const base = {
            providerMessageId: String(m.id),
            from: normalisePhone(String(m.from)),
            to: businessNumber,
            sentAt: new Date(Number(m.timestamp ?? 0) * 1000),
            providerId: "meta" as const,
          };

          if (m.type === "text") {
            messages.push({ ...base, kind: "text", text: String(m.text?.body ?? "") });
          } else if (m.type === "interactive") {
            const br = m.interactive?.button_reply;
            const lr = m.interactive?.list_reply;
            const picked = br ?? lr;
            messages.push({
              ...base,
              kind: "interactive",
              text: "",
              reply: picked
                ? { id: String(picked.id ?? ""), title: String(picked.title ?? "") }
                : undefined,
            });
          } else if (m.type === "button") {
            // Template quick-reply buttons arrive as type "button", not "interactive".
            messages.push({
              ...base,
              kind: "interactive",
              text: "",
              reply: {
                id: String(m.button?.payload ?? ""),
                title: String(m.button?.text ?? ""),
              },
            });
          } else if (["image", "audio", "video", "document", "sticker"].includes(m.type)) {
            const payload = m[m.type];
            messages.push({
              ...base,
              kind: "media",
              text: String(payload?.caption ?? ""),
              media: {
                id: String(payload?.id ?? ""),
                mimeType: String(payload?.mime_type ?? ""),
              },
            });
          } else if (m.type === "reaction") {
            // A thumbs-up on one of Buddy's messages needs no reply.
            continue;
          } else {
            messages.push({ ...base, kind: "unsupported", text: "" });
          }
        }

        for (const s of value?.statuses ?? []) {
          if (!s?.id || !s?.status) continue;
          const status = String(s.status);
          if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
          statuses.push({
            providerMessageId: String(s.id),
            status: status as StatusUpdate["status"],
            at: new Date(Number(s.timestamp ?? 0) * 1000),
            error: s?.errors?.[0]?.title ? String(s.errors[0].title) : undefined,
            providerId: "meta",
          });
        }
      }
    }

    return { messages, statuses };
  },

  async send(message, secrets) {
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${secrets.senderId}/messages`;
    const to = normalisePhone(message.to).replace(/^\+/, "");
    let payload: Record<string, unknown>;

    if (message.kind === "text") {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message.body, preview_url: false },
      };
    } else if (message.kind === "buttons") {
      if (message.buttons.length > 3) {
        throw new Error("WhatsApp allows at most 3 reply buttons");
      }
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.body },
          action: {
            buttons: message.buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
    } else if (message.kind === "list") {
      if (message.rows.length > 10) {
        throw new Error("WhatsApp allows at most 10 list rows");
      }
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.body },
          action: {
            button: message.buttonLabel,
            sections: [{ rows: message.rows }],
          },
        },
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          components: [
            ...(message.variables.length
              ? [
                  {
                    type: "body",
                    parameters: message.variables.map((v) => ({ type: "text", text: v })),
                  },
                ]
              : []),
            ...(message.buttonPayloads ?? []).map((payload, i) => ({
              type: "button",
              sub_type: "quick_reply",
              index: String(i),
              parameters: [{ type: "payload", payload }],
            })),
          ],
        },
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secrets.accessToken ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // Status only. The response body can echo the patient's text back.
      throw new Error(`Meta send failed with HTTP ${res.status}`);
    }
    const json: any = await res.json();
    return { providerMessageId: String(json?.messages?.[0]?.id ?? "") };
  },
};

/* ------------------------------------------------------------------ */
/* Twilio                                                              */
/* ------------------------------------------------------------------ */

function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw).entries()) out[key] = value;
  return out;
}

const TWILIO_STATUS_MAP: Record<string, StatusUpdate["status"]> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  undelivered: "failed",
};

export const twilioProvider: WhatsAppProvider = {
  id: "twilio",

  async verifySignature(req, secrets) {
    const given = header(req, "x-twilio-signature");
    if (!given) return false;
    // Twilio signs the full URL with the POST params appended in key order.
    const params = parseForm(req.rawBody);
    const sorted = Object.keys(params).sort();
    let data = req.url;
    for (const key of sorted) data += key + params[key];
    const expected = await hmac("SHA-1", secrets.signingSecret, data);
    const supplied = base64ToBytes(given);
    if (!supplied) return false;
    return timingSafeEqual(expected, supplied);
  },

  parseWebhook(req) {
    const messages: InboundMessage[] = [];
    const statuses: StatusUpdate[] = [];
    const p = parseForm(req.rawBody);
    const sid = p.MessageSid ?? p.SmsSid ?? "";
    if (!sid) return { messages, statuses };

    if (p.MessageStatus || p.SmsStatus) {
      const raw = (p.MessageStatus ?? p.SmsStatus ?? "").toLowerCase();
      const mapped = TWILIO_STATUS_MAP[raw];
      if (mapped) {
        statuses.push({
          providerMessageId: sid,
          status: mapped,
          at: new Date(),
          error: p.ErrorCode ? `Twilio error ${p.ErrorCode}` : undefined,
          providerId: "twilio",
        });
        // Status callbacks carry no Body. Nothing further to do.
        if (!p.Body && !p.ButtonPayload && !p.ListId) return { messages, statuses };
      }
    }

    const base = {
      providerMessageId: sid,
      from: normalisePhone(p.From ?? ""),
      to: normalisePhone(p.To ?? ""),
      // Twilio does not send a patient-side timestamp on the inbound webhook.
      sentAt: new Date(),
      providerId: "twilio" as const,
    };

    const numMedia = Number(p.NumMedia ?? "0");
    const replyId = p.ButtonPayload ?? p.ListId;

    if (replyId) {
      messages.push({
        ...base,
        kind: "interactive",
        text: "",
        reply: { id: replyId, title: p.ButtonText ?? p.ListTitle ?? "" },
      });
    } else if (numMedia > 0) {
      messages.push({
        ...base,
        kind: "media",
        text: p.Body ?? "",
        media: { id: p.MediaUrl0 ?? "", mimeType: p.MediaContentType0 ?? "" },
      });
    } else if (p.Body !== undefined) {
      messages.push({ ...base, kind: "text", text: p.Body });
    }

    return { messages, statuses };
  },

  async send(message, secrets) {
    // Twilio has no native interactive-message API on the plain Messages
    // resource, so buttons and lists degrade to numbered text. Flagged rather
    // than hidden: if we pick Twilio, the question flow has to be text-first.
    let body: string;
    const form = new URLSearchParams();

    if (message.kind === "text") {
      body = message.body;
    } else if (message.kind === "buttons") {
      body = `${message.body}\n\n${message.buttons
        .map((b, i) => `${i + 1}. ${b.title}`)
        .join("\n")}`;
    } else if (message.kind === "list") {
      body = `${message.body}\n\n${message.rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n")}`;
    } else {
      form.set("ContentSid", message.templateName);
      form.set(
        "ContentVariables",
        JSON.stringify(Object.fromEntries(message.variables.map((v, i) => [String(i + 1), v]))),
      );
      body = "";
    }

    form.set("From", `whatsapp:${normalisePhone(secrets.senderId)}`);
    form.set("To", `whatsapp:${normalisePhone(message.to)}`);
    if (body) form.set("Body", body);

    const accountSid = secrets.accessToken ?? "";
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${secrets.signingSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!res.ok) throw new Error(`Twilio send failed with HTTP ${res.status}`);
    const json: any = await res.json();
    return { providerMessageId: String(json?.sid ?? "") };
  },
};

/* ------------------------------------------------------------------ */

export function getProvider(id: string | undefined): WhatsAppProvider {
  if (id === "twilio") return twilioProvider;
  if (id === "meta") return metaProvider;
  throw new Error("WHATSAPP_PROVIDER is not set to 'meta' or 'twilio'. Refusing to guess.");
}
