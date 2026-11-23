import { afterEach, describe, expect, it } from "vitest";
import {
  connectStartedOnWatchLink,
  mintWatchToken,
  prefixWatchOAuthState,
  verifyWatchToken,
  watchLinkUrl,
  watchTokenExpiresAt,
  wearableReturnUrl,
} from "./watch-link.server";

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

  it("reads the expiry baked into the token", async () => {
    const t = (await mintWatchToken(ID, NOW, KEY))!;
    expect(watchTokenExpiresAt(t)).toBe(
      new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(watchTokenExpiresAt("nope")).toBeNull();
  });
});

describe("watch oauth return", () => {
  const prev = process.env.WATCH_LINK_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.WATCH_LINK_SECRET;
    else process.env.WATCH_LINK_SECRET = prev;
  });

  function adminWith(authUserId: string | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { auth_user_id: authUserId } }),
          }),
        }),
      }),
    } as never;
  }

  it("marks only connect-watch states", () => {
    expect(connectStartedOnWatchLink(prefixWatchOAuthState("abc", "watch"))).toBe(true);
    expect(connectStartedOnWatchLink(prefixWatchOAuthState("abc", "app"))).toBe(false);
    expect(prefixWatchOAuthState("abc", "watch")).toBe("w.abc");
  });

  it("returns an app login to the profile, and a watch-link connect to the public page", async () => {
    process.env.WATCH_LINK_SECRET = KEY;
    const app = await wearableReturnUrl(
      adminWith("user-1"),
      "https://x.test",
      ID,
      "garmin",
      "connected",
    );
    expect(app).toContain("/client/app/profile?wearable=garmin");
    const watch = await wearableReturnUrl(
      adminWith("user-1"),
      "https://x.test",
      ID,
      "garmin",
      "connected",
      true,
    );
    expect(watch).toContain("/connect-watch?t=");
    expect(watch).toContain("wearable=garmin");
    expect(watch).not.toContain("/client/app/profile");
    const noLogin = await wearableReturnUrl(
      adminWith(null),
      "https://x.test",
      ID,
      "oura",
      "connected",
    );
    expect(noLogin).toContain("/connect-watch?t=");
  });
});
