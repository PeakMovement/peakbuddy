import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { labAdvance, labSend, labSnapshot, newLab } from "./engine.server";
import { resetPractitionerCache } from "@/lib/whatsapp/practitioner-mode.server";

const SEALED = [
  "ANTHROPIC_API_KEY",
  "LOVABLE_API_KEY",
  "GEMINI_API_KEY",
  "WHATSAPP_PROVIDER",
  "META_APP_SECRET",
  "META_PHONE_NUMBER_ID",
  "WHATSAPP_RECEPTION_NUMBER",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SEALED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  resetPractitionerCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T08:00:00Z"));
});

afterEach(() => {
  for (const k of SEALED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.useRealTimers();
});

const outs = (lines: Array<{ dir: string; who: string; text: string }>, who: string) =>
  lines.filter((l) => l.dir === "out" && l.who === who).map((l) => l.text);

describe("Test Lab", () => {
  it("a patient check-in runs the real worker and stays in the sandbox", async () => {
    let state = newLab();
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    let r = await labSend(state, { from: "sam", text: "hi" });
    state = r.state;
    expect(outs(r.lines, "sam").length).toBeGreaterThan(0);

    r = await labSend(state, { from: "sam", text: "3" });
    state = r.state;
    const snap = labSnapshot(state).find((p) => p.key === "sam");
    expect(snap?.exists).toBe(true);
    // No network: no AI keys, and sends go to the capture provider.
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("a red flag raises an alert that is captured, not delivered", async () => {
    let state = newLab();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const r = await labSend(state, {
      from: "pieter",
      text: "I can't feel my legs and I've lost control of my bladder",
    });
    state = r.state;
    const alerts = state.tables.alerts ?? [];
    expect(alerts.length).toBeGreaterThan(0);
    expect(r.lines.some((l) => l.dir === "event" || l.who === "physio" || l.who === "owner")).toBe(
      true,
    );
    vi.unstubAllGlobals();
  });

  it("the practitioner side answers from the sandbox practice", async () => {
    const state = newLab();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const r = await labSend(state, { from: "physio", text: "how are my clients" });
    const reply = outs(r.lines, "physio").join("\n");
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/Cayla|Vicki/);
    vi.unstubAllGlobals();
  });

  it("skipping to reminder time sends due reminders through the capture provider", async () => {
    process.env.WHATSAPP_REMINDER_TEMPLATE = "buddy_checkin_reminder";
    const state = newLab();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const r = await labAdvance(state, "reminder");
    const reminded = r.lines.filter((l) => l.dir === "out").map((l) => l.who);
    // Sam, Pieter and Nomsa are daily. Lerato is Mondays only (28 Oct 2026 is a Wednesday).
    expect(reminded).not.toContain("lerato");
    expect(r.result.join(" ")).toContain("reminders:");
    delete process.env.WHATSAPP_REMINDER_TEMPLATE;
    vi.unstubAllGlobals();
  });
});
