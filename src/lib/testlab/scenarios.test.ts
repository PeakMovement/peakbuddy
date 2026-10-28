import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPractitionerCache } from "@/lib/whatsapp/practitioner-mode.server";

// Tripwire: the Lab must never touch the live database.
const touched: string[] = [];
vi.mock("@/integrations/supabase/client.server", async () => {
  const { inSandbox } = await import("./sandbox");
  return {
    supabaseAdmin: new Proxy(
      {},
      {
        get(_t, prop) {
          if (inSandbox()) touched.push(String(prop));
          throw new Error("live database touched in a test");
        },
      },
    ),
  };
});

const SEALED = [
  "ANTHROPIC_API_KEY",
  "LOVABLE_API_KEY",
  "GEMINI_API_KEY",
  "WHATSAPP_PROVIDER",
  "WHATSAPP_RECEPTION_NUMBER",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of SEALED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetPractitionerCache();
  touched.length = 0;
  process.env.WHATSAPP_REMINDER_TEMPLATE = "buddy_checkin_reminder";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T08:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
});
afterEach(() => {
  delete process.env.WHATSAPP_REMINDER_TEMPLATE;
  for (const k of SEALED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Test Lab scenarios", () => {
  it("every scenario runs without touching the live database", async () => {
    const { runScenarios } = await import("./runner.server");
    const results = await runScenarios();
    expect(touched).toEqual([]);
    for (const r of results) expect(r.error, r.id).toBeNull();
    const summary = results.map(
      (r) => `${r.passed ? "PASS" : "FAIL"} ${r.id}${r.feature ? " (new)" : ""}`,
    );
    console.log(summary.join("\n"));
  }, 60_000);
});
