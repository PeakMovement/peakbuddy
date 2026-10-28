import { describe, expect, it } from "vitest";
import { gradeButtonId, gradeQuestion, readGradeButton } from "./alert-grading.server";

const id = "00000000-0000-4000-8000-000000000033";

describe("grading red flags", () => {
  it("button ids round-trip and fit WhatsApp's limits", () => {
    for (const g of ["confirmed", "false_alarm", "already_aware"] as const) {
      const b = gradeButtonId(g, id);
      expect(b.length).toBeLessThanOrEqual(256);
      expect(readGradeButton(b)).toEqual({ grade: g, alertId: id });
    }
    expect(readGradeButton("prac_grade_x_nope")).toBeNull();
  });
  it("asks with the patient's name and day", () => {
    const q = gradeQuestion("Lerato Fakename", "2026-10-28T08:00:00Z")(id);
    expect(q.body).toBe(
      "Quick one, to help Buddy learn: was Lerato Fakename's red flag on Wednesday a real concern?",
    );
    expect(q.buttons.map((b) => b.title)).toEqual(["Real concern", "False alarm", "Already knew"]);
  });
});
