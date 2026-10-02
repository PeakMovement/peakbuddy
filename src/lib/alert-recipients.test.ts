import { describe, it, expect } from "vitest";
import { resolveAlertRecipients, type RecipientLookup } from "./alert-recipients";

const lookup = (practiceId: string | null, owner: string | null): RecipientLookup => ({
  async practiceIdForClient() {
    return practiceId;
  },
  async ownerForPractice() {
    return owner;
  },
});

const failing: RecipientLookup = {
  async practiceIdForClient() {
    throw new Error("database is down");
  },
  async ownerForPractice() {
    throw new Error("database is down");
  },
};

describe("red flags reach the practice owner as well", () => {
  it("adds the owner", async () => {
    const r = await resolveAlertRecipients(lookup("prac-1", "owner-1"), {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds).toEqual(["treating-1", "owner-1"]);
    expect(r.includedOwner).toBe(true);
  });

  it("does not double up when the owner is the treating practitioner", async () => {
    const r = await resolveAlertRecipients(lookup("prac-1", "treating-1"), {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds).toEqual(["treating-1"]);
    expect(r.includedOwner).toBe(false);
  });

  it("puts the treating practitioner first", async () => {
    const r = await resolveAlertRecipients(lookup("prac-1", "owner-1"), {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds[0]).toBe("treating-1");
  });
});

describe("the treating practitioner never loses their alert", () => {
  it("keeps them when the client has no practice", async () => {
    const r = await resolveAlertRecipients(lookup(null, null), {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds).toEqual(["treating-1"]);
  });

  it("keeps them when the practice has no owner recorded", async () => {
    const r = await resolveAlertRecipients(lookup("prac-1", null), {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds).toEqual(["treating-1"]);
  });

  it("keeps them when the lookup throws", async () => {
    const r = await resolveAlertRecipients(failing, {
      practitioner_id: "treating-1",
      client_id: "c1",
      alert_type: "red_flag",
    });
    expect(r.userIds).toEqual(["treating-1"]);
    expect(r.includedOwner).toBe(false);
  });
});

describe("ordinary alerts stay with the treating practitioner", () => {
  for (const type of ["morning_insight", "checkin_missed", "", null]) {
    it(`does not fan out ${String(type) || "an untyped alert"}`, async () => {
      const r = await resolveAlertRecipients(lookup("prac-1", "owner-1"), {
        practitioner_id: "treating-1",
        client_id: "c1",
        alert_type: type,
      });
      expect(r.userIds).toEqual(["treating-1"]);
      expect(r.includedOwner).toBe(false);
    });
  }
});
