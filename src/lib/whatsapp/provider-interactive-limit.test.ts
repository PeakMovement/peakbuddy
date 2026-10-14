import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { INTERACTIVE_BODY_MAX, metaProvider, splitInteractiveBody } from "./provider";
import { PRAC_MSG } from "./practitioner-mode.server";

const secrets = { senderId: "1", accessToken: "x" } as any;

afterEach(() => vi.unstubAllGlobals());

describe("button and list bodies over Meta's 1024 limit", () => {
  it("the practitioner help message is over the limit (what failed on 13 Oct)", () => {
    expect(PRAC_MSG.help("Justin").length).toBeGreaterThan(INTERACTIVE_BODY_MAX);
  });

  it("splits at the last paragraph", () => {
    const { head, tail } = splitInteractiveBody(PRAC_MSG.help("Justin"));
    expect(tail.startsWith("Practice owners can also ask")).toBe(true);
    expect(head).toContain("Here's what I can do");
    expect(tail.length).toBeLessThanOrEqual(INTERACTIVE_BODY_MAX);
  });

  it("sends the text first, then the buttons with a body Meta accepts", async () => {
    const sent: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ messages: [{ id: `w${sent.length}` }] }) };
      }),
    );
    await metaProvider.send(
      {
        kind: "buttons",
        to: "27600000011",
        body: PRAC_MSG.help("Justin"),
        buttons: [{ id: "prac_status", title: "My clients" }],
      },
      secrets,
    );
    expect(sent.map((p) => p.type)).toEqual(["text", "interactive"]);
    expect(sent[1].interactive.body.text.length).toBeLessThanOrEqual(INTERACTIVE_BODY_MAX);
  });

  it("short bodies are untouched", async () => {
    const sent: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: any) => {
        sent.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ messages: [{ id: "w" }] }) };
      }),
    );
    await metaProvider.send(
      { kind: "buttons", to: "27600000011", body: "Hi", buttons: [{ id: "a", title: "A" }] },
      secrets,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].interactive.body.text).toBe("Hi");
  });
});
