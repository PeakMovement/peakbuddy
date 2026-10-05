import { describe, expect, it } from "vitest";
import { isSafe, splitHash } from "./after-login";

describe("after-login return path", () => {
  it("only honours paths inside the client app", () => {
    expect(isSafe("/client/app/profile#wearables")).toBe(true);
    expect(isSafe("/client/app/checkin")).toBe(true);
    expect(isSafe("https://evil.example/client/app/x")).toBe(false);
    expect(isSafe("//evil.example")).toBe(false);
    expect(isSafe("/practitioner/app/dashboard")).toBe(false);
    expect(isSafe("/client/app/../../admin")).toBe(false);
  });
  it("splits the hash off for the router", () => {
    expect(splitHash("/client/app/profile#wearables")).toEqual({
      to: "/client/app/profile",
      hash: "wearables",
    });
    expect(splitHash("/client/app/checkin")).toEqual({ to: "/client/app/checkin" });
  });
});
