import { describe, it, expect } from "vitest";
import { handleWebhook, verifyHandshake, type InboundStore } from "./webhook-handler";
import type { ProviderSecrets } from "./provider";

/**
 * The two failure modes this endpoint has are "accepts something forged" and
 * "loses something genuine". Everything below is one or the other.
 */

const APP_SECRET = "test-app-secret-not-a-real-one";
const VERIFY_TOKEN = "test-verify-token";

const metaSecrets: ProviderSecrets = {
  signingSecret: APP_SECRET,
  senderId: "1249213571616397",
  accessToken: "test-access-token",
  verifyToken: VERIFY_TOKEN,
};

const twilioSecrets: ProviderSecrets = {
  signingSecret: APP_SECRET,
  senderId: "+27110000000",
  accessToken: "ACtest",
};

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function twilioSig(secret: string, url: string, form: string): Promise<string> {
  const params = new URLSearchParams(form);
  const sorted = [...params.keys()].sort();
  let data = url;
  for (const k of sorted) data += k + params.get(k);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function metaBody(text: string, id = "wamid.TEST1") {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: "27110000000" },
              messages: [
                {
                  id,
                  from: "27825551234",
                  timestamp: "1790000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function makeStore(behaviour: "ok" | "duplicate" | "throw" = "ok") {
  const seen: string[] = [];
  const store: InboundStore = {
    async enqueue(m) {
      if (behaviour === "throw") throw new Error("database is down");
      seen.push(m.providerMessageId);
      return behaviour === "duplicate" ? "duplicate" : "stored";
    },
    async recordStatus() {
      if (behaviour === "throw") throw new Error("database is down");
    },
  };
  return { store, seen };
}

describe("a forged request is never accepted", () => {
  it("rejects a missing signature", async () => {
    const { store, seen } = makeStore();
    const body = metaBody("hello");
    const out = await handleWebhook(
      { rawBody: body, headers: {}, url: "https://example.test/hook" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(403);
    expect(out.summary.rejected).toBe("signature");
    expect(seen.length).toBe(0);
  });

  it("rejects a wrong signature", async () => {
    const { store, seen } = makeStore();
    const body = metaBody("hello");
    const out = await handleWebhook(
      {
        rawBody: body,
        headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) },
        url: "https://example.test/hook",
      },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(403);
    expect(seen.length).toBe(0);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const { store } = makeStore();
    const body = metaBody("hello");
    const sig = await hmacHex("a-different-secret", body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(403);
  });

  it("rejects a body tampered with after signing", async () => {
    const { store } = makeStore();
    const original = metaBody("pain is 3");
    const sig = await hmacHex(APP_SECRET, original);
    const tampered = metaBody("pain is 9");
    const out = await handleWebhook(
      { rawBody: tampered, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(403);
  });

  it("rejects malformed signature material without throwing", async () => {
    const { store } = makeStore();
    const body = metaBody("hello");
    for (const header of ["", "sha256=", "sha256=zz", "nonsense", "sha1=abcd"]) {
      const out = await handleWebhook(
        { rawBody: body, headers: { "x-hub-signature-256": header }, url: "u" },
        { provider: "meta", secrets: metaSecrets, store },
      );
      expect(out.status).toBe(403);
    }
  });

  it("rejects a Twilio signature on a Meta-configured endpoint", async () => {
    const { store } = makeStore();
    const form = "MessageSid=SM1&From=whatsapp%3A%2B27825551234&Body=hello";
    const out = await handleWebhook(
      { rawBody: form, headers: { "x-twilio-signature": "whatever" }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(403);
  });
});

describe("a genuine request is accepted", () => {
  it("accepts a correctly signed Meta message", async () => {
    const { store, seen } = makeStore();
    const body = metaBody("I am short of breath");
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "X-Hub-Signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(200);
    expect(out.summary.accepted).toBe(1);
    expect(seen).toEqual(["wamid.TEST1"]);
  });

  it("accepts a correctly signed Twilio message", async () => {
    const { store, seen } = makeStore();
    const url = "https://example.test/api/public/whatsapp/webhook";
    const form = "Body=pain+is+4&From=whatsapp%3A%2B27825551234&MessageSid=SM123&To=whatsapp%3A%2B27110000000";
    const sig = await twilioSig(APP_SECRET, url, form);
    const out = await handleWebhook(
      { rawBody: form, headers: { "x-twilio-signature": sig }, url },
      { provider: "twilio", secrets: twilioSecrets, store },
    );
    expect(out.status).toBe(200);
    expect(out.summary.accepted).toBe(1);
    expect(seen).toEqual(["SM123"]);
  });
});

describe("a genuine request is never lost", () => {
  it("returns 500 when our own storage fails, so the provider redelivers it", async () => {
    const { store } = makeStore("throw");
    const body = metaBody("hello");
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(500);
    expect(out.summary.failed).toBe(1);
    expect(out.summary.accepted).toBe(0);
  });

  it("counts a redelivery as a duplicate rather than a new message", async () => {
    const { store } = makeStore("duplicate");
    const body = metaBody("hello");
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.summary.duplicates).toBe(1);
    expect(out.summary.accepted).toBe(0);
  });

  it("returns 200 on a verified but unreadable body", async () => {
    const { store } = makeStore();
    const body = "{not json at all";
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.status).toBe(200);
    expect(out.summary.accepted).toBe(0);
  });

  it("stores the readable messages in a batch even when one is malformed", async () => {
    const { store, seen } = makeStore();
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "27110000000" },
                messages: [
                  { id: "wamid.A", from: "27825551234", timestamp: "1790000000", type: "text", text: { body: "one" } },
                  { from: "27825551234", type: "text", text: { body: "no id" } },
                  { id: "wamid.C", from: "27825559999", timestamp: "1790000000", type: "text", text: { body: "three" } },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.summary.accepted).toBe(2);
    expect(seen).toEqual(["wamid.A", "wamid.C"]);
  });

  it("records delivery statuses", async () => {
    const { store } = makeStore();
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { display_phone_number: "27110000000" },
                statuses: [
                  { id: "wamid.A", status: "delivered", timestamp: "1790000000" },
                  { id: "wamid.B", status: "failed", timestamp: "1790000000", errors: [{ title: "Undeliverable" }] },
                ],
              },
            },
          ],
        },
      ],
    });
    const sig = await hmacHex(APP_SECRET, body);
    const out = await handleWebhook(
      { rawBody: body, headers: { "x-hub-signature-256": `sha256=${sig}` }, url: "u" },
      { provider: "meta", secrets: metaSecrets, store },
    );
    expect(out.summary.statuses).toBe(2);
  });
});

describe("the Meta subscription handshake", () => {
  it("echoes the challenge when the token matches", () => {
    const p = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "1234567890",
    });
    expect(verifyHandshake(p, metaSecrets)).toEqual({ status: 200, body: "1234567890" });
  });

  it("refuses a wrong token", () => {
    const p = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "1234567890",
    });
    expect(verifyHandshake(p, metaSecrets).status).toBe(403);
  });

  it("refuses when no verify token is configured, rather than echoing to anyone", () => {
    const p = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "",
      "hub.challenge": "1234567890",
    });
    expect(verifyHandshake(p, { ...metaSecrets, verifyToken: undefined }).status).toBe(403);
  });

  it("refuses a mode other than subscribe", () => {
    const p = new URLSearchParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "1234567890",
    });
    expect(verifyHandshake(p, metaSecrets).status).toBe(403);
  });
});

describe("configuration", () => {
  it("refuses to guess a provider", async () => {
    const { store } = makeStore();
    const out = await handleWebhook(
      { rawBody: "{}", headers: {}, url: "u" },
      { provider: "nonsense" as never, secrets: metaSecrets, store },
    );
    expect(out.status).toBe(500);
    expect(out.summary.rejected).toBe("provider");
  });
});
