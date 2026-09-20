import { describe, it, expect } from "vitest";
import { verifyGarminWebhookSignature, garminWebhookSignatureFrom } from "./garmin";

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyGarminWebhookSignature", () => {
  const secret = "garmin-consumer-secret";
  const body = '{"dailies":[]}';

  it("accepts a matching hex HMAC", async () => {
    const signature = await hmacHex(secret, body);
    await expect(verifyGarminWebhookSignature({ secret, rawBody: body, signature })).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong signature", async () => {
    await expect(
      verifyGarminWebhookSignature({ secret, rawBody: body, signature: "deadbeef" }),
    ).resolves.toBe(false);
  });

  it("rejects a signature for a different body", async () => {
    const signature = await hmacHex(secret, body);
    await expect(
      verifyGarminWebhookSignature({ secret, rawBody: '{"dailies":[{"userId":"x"}]}', signature }),
    ).resolves.toBe(false);
  });
});

describe("garminWebhookSignatureFrom", () => {
  it("reads the Garmin signature header", () => {
    const headers = new Headers({ "x-garmin-signature": "abc" });
    expect(garminWebhookSignatureFrom(headers)).toBe("abc");
  });

  it("returns null when unsigned", () => {
    expect(garminWebhookSignatureFrom(new Headers())).toBeNull();
  });
});
