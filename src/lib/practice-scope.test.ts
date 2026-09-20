import { describe, it, expect } from "vitest";
import { resolvePracticeClientScope } from "./practice-scope";

describe("resolvePracticeClientScope", () => {
  it("gives the practice owner the full practice roster", () => {
    expect(
      resolvePracticeClientScope({
        userId: "owner-1",
        practiceId: "prac-1",
        isOwner: true,
      }),
    ).toEqual({ mode: "practice", practiceId: "prac-1" });
  });

  it("gives a member only their own caseload", () => {
    expect(
      resolvePracticeClientScope({
        userId: "member-1",
        practiceId: "prac-1",
        isOwner: false,
      }),
    ).toEqual({ mode: "own", practitionerId: "member-1" });
  });

  it("falls back to own caseload without a practice id", () => {
    expect(
      resolvePracticeClientScope({
        userId: "solo-1",
        practiceId: null,
        isOwner: true,
      }),
    ).toEqual({ mode: "own", practitionerId: "solo-1" });
  });
});
