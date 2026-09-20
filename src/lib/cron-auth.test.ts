import { describe, it, expect } from "vitest";
import { authorizeCronRequest } from "./cron-auth";

describe("authorizeCronRequest", () => {
  it("returns 401 when CRON_SECRET is unset", () => {
    const res = authorizeCronRequest(new Request("https://example.test/hooks"), undefined);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns 401 when the header does not match", () => {
    const req = new Request("https://example.test/hooks", {
      headers: { "x-cron-secret": "wrong" },
    });
    const res = authorizeCronRequest(req, "expected-secret");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns null (authorized) when the secret matches", () => {
    const req = new Request("https://example.test/hooks", {
      headers: { "x-cron-secret": "expected-secret" },
    });
    expect(authorizeCronRequest(req, "expected-secret")).toBeNull();
  });

  it("accepts Bearer authorization", () => {
    const req = new Request("https://example.test/hooks", {
      headers: { authorization: "Bearer expected-secret" },
    });
    expect(authorizeCronRequest(req, "expected-secret")).toBeNull();
  });
});
