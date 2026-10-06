import { describe, it, expect } from "vitest";
import { authorizeCronRequest } from "./cron-auth";

const VAULT = "v".repeat(48);
const vaultYes = async (t: string) => t === VAULT;
const req = (headers: Record<string, string> = {}) =>
  new Request("https://example.test/hooks", { headers });

describe("authorizeCronRequest", () => {
  it("returns 401 with no secret anywhere", async () => {
    const res = await authorizeCronRequest(req(), undefined, async () => false);
    expect(res?.status).toBe(401);
  });

  it("returns 401 when the header matches neither", async () => {
    const res = await authorizeCronRequest(
      req({ "x-cron-secret": "wrong" }),
      "expected-secret",
      vaultYes,
    );
    expect(res?.status).toBe(401);
  });

  it("allows the CRON_SECRET setting, by header or Bearer", async () => {
    expect(
      await authorizeCronRequest(req({ "x-cron-secret": "expected-secret" }), "expected-secret"),
    ).toBeNull();
    expect(
      await authorizeCronRequest(
        req({ authorization: "Bearer expected-secret" }),
        "expected-secret",
      ),
    ).toBeNull();
  });

  it("allows the Vault secret the scheduled jobs send, even when CRON_SECRET differs or is unset", async () => {
    expect(
      await authorizeCronRequest(req({ authorization: `Bearer ${VAULT}` }), undefined, vaultYes),
    ).toBeNull();
    expect(
      await authorizeCronRequest(req({ authorization: `Bearer ${VAULT}` }), "other", vaultYes),
    ).toBeNull();
  });

  it("never asks the database about short guesses", async () => {
    let asked = false;
    const res = await authorizeCronRequest(
      req({ authorization: "Bearer short" }),
      undefined,
      async () => {
        asked = true;
        return true;
      },
    );
    expect(res?.status).toBe(401);
    expect(asked).toBe(false);
  });
});
