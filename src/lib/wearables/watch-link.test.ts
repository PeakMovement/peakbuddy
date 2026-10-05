import { describe, expect, it } from "vitest";
import { mintWatchToken, verifyWatchToken, watchLinkUrl } from "./watch-link.server";

const KEY = "test-secret";
const ID = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-10-05T10:00:00Z");

describe("watch links", () => {
  it("round trips for the profile it was made for", async () => {
    const t = await mintWatchToken(ID, NOW, KEY);
    expect(t).toBeTruthy();
    expect(await verifyWatchToken(t!, NOW, KEY)).toBe(ID);
    expect(watchLinkUrl("https://x.test", t!)).toContain("/connect-watch?t=");
  });

  it("rejects tampering, another key, and expiry", async () => {
    const t = (await mintWatchToken(ID, NOW, KEY))!;
    const other = "99999999-2222-4333-8444-555555555555";
    expect(await verifyWatchToken(t.replace(ID, other), NOW, KEY)).toBeNull();
    expect(await verifyWatchToken(t, NOW, "another-secret")).toBeNull();
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(await verifyWatchToken(t, later, KEY)).toBeNull();
    expect(await verifyWatchToken("junk", NOW, KEY)).toBeNull();
  });

  it("makes nothing without a secret or a real id", async () => {
    expect(await mintWatchToken(ID, NOW, null)).toBeNull();
    expect(await mintWatchToken("not-a-uuid", NOW, KEY)).toBeNull();
  });
});
