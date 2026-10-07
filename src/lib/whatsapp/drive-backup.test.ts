import { describe, expect, it } from "vitest";
import { previousWeek, renderTranscript, runWeeklyDriveBackup } from "./drive-backup.server";

// Synthetic only.
describe("weekly Drive backup", () => {
  it("picks last Monday to Sunday in South African time", () => {
    const w = previousWeek(new Date("2026-10-12T01:00:00Z")); // Monday 03:00 SAST
    expect(w.label).toBe("2026-10-05 to 2026-10-11");
    expect(w.start.toISOString()).toBe("2026-10-04T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-11T22:00:00.000Z");
  });

  it("renders both sides in time order", () => {
    const t = renderTranscript("Test Patient", "w", [
      { at: "2026-10-06T16:01:00Z", who: "Patient", text: "4" },
      { at: "2026-10-06T16:00:00Z", who: "Buddy", text: "How is your pain?" },
    ]);
    expect(t.indexOf("Buddy: How")).toBeLessThan(t.indexOf("Patient: 4"));
    expect(t).toContain("[2026-10-06 18:00]");
  });

  it("does nothing until the Drive connector is linked", async () => {
    const r = await runWeeklyDriveBackup({} as never, new Date(), null);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not linked/);
  });
});
