import { describe, expect, it, vi } from "vitest";
import { sendPractitionerWhatsAppAlert, urgencyWords } from "./practitioner-alert.server";

function fakeAdmin(phones: Record<string, string | null>) {
  const inserts: unknown[] = [];
  const admin = {
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { phone: phones[id] ?? null } } }),
      },
    },
    from: () => ({
      insert: (row: unknown) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { admin: admin as never, inserts };
}

describe("practitioner whatsapp alert", () => {
  it("maps urgency to plain words", () => {
    expect(urgencyWords("emergency")).toBe("urgent");
    expect(urgencyWords("soon")).toBe("same day");
    expect(urgencyWords("monitor")).toBe("routine");
  });

  it("does nothing when the template is not configured", async () => {
    const { admin } = fakeAdmin({ a: "0821234567" });
    expect(await sendPractitionerWhatsAppAlert(admin, ["a"], "urgent", null)).toBe(0);
  });

  it("sends the template once per number, skipping practitioners with no phone", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "m1" });
    const { admin, inserts } = fakeAdmin({ a: "0821234567", b: null, c: "+27 82 123 4567" });
    const n = await sendPractitionerWhatsAppAlert(admin, ["a", "b", "c", "a"], "emergency", {
      provider: { id: "meta", send } as never,
      secrets: {} as never,
      templateName: "buddy_patient_alert",
      languageCode: "en",
    });
    expect(n).toBe(1);
    expect(send).toHaveBeenCalledWith(
      {
        kind: "template",
        to: "27821234567",
        templateName: "buddy_patient_alert",
        languageCode: "en",
        variables: ["urgent"],
      },
      {},
    );
    expect(inserts).toHaveLength(1);
  });

  it("never throws when sending fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("131047"));
    const { admin } = fakeAdmin({ a: "0821234567" });
    const n = await sendPractitionerWhatsAppAlert(admin, ["a"], "urgent", {
      provider: { id: "meta", send } as never,
      secrets: {} as never,
      templateName: "t",
      languageCode: "en",
    });
    expect(n).toBe(0);
  });
});
