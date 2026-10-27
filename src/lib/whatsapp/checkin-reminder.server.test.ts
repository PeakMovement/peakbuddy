import { describe, expect, it } from "vitest";
import { claimAndDeliverCheckinReminder } from "./checkin-reminder.server";

function reminderAdmin(initial: string | null) {
  const row = { id: "r1", last_sent_on: initial };
  const from = () => {
    const filters: Array<(r: typeof row) => boolean> = [];
    let patch: Record<string, unknown> | null = null;
    const api = {
      update: (p: Record<string, unknown>) => ((patch = p), api),
      eq: (k: string, v: unknown) => (
        filters.push((r) => (r as Record<string, unknown>)[k] === v),
        api
      ),
      or: (expr: string) => {
        const date = expr.split("neq.")[1];
        filters.push((r) => r.last_sent_on == null || r.last_sent_on !== date);
        return api;
      },
      select: () => api,
      maybeSingle: () => {
        const ok = filters.every((f) => f(row));
        if (ok && patch) Object.assign(row, patch);
        return Promise.resolve({ data: ok ? { id: row.id } : null, error: null });
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const ok = filters.every((f) => f(row));
        if (ok && patch) Object.assign(row, patch);
        return Promise.resolve({ data: ok ? [row] : [], error: null }).then(resolve, reject);
      },
    };
    return api;
  };
  return { row, admin: { from } as never };
}

const TODAY = "2026-10-26";

describe("check-in reminder claim", () => {
  it("keeps the day only after WhatsApp delivery", async () => {
    const db = reminderAdmin("2026-10-25");
    const pushes: string[] = [];
    const outcome = await claimAndDeliverCheckinReminder(db.admin, {
      reminderId: "r1",
      authUserId: "user-1",
      localDate: TODAY,
      previousSentOn: "2026-10-25",
      sendWhatsApp: async () => "sent",
      sendPush: async (userId) => {
        pushes.push(userId);
        return { delivered: 1 };
      },
    });
    expect(outcome).toBe("sent");
    expect(db.row.last_sent_on).toBe(TODAY);
    expect(pushes).toEqual([]);
  });

  it("puts the previous day back when neither channel delivers", async () => {
    const db = reminderAdmin(null);
    const outcome = await claimAndDeliverCheckinReminder(db.admin, {
      reminderId: "r1",
      authUserId: "user-1",
      localDate: TODAY,
      previousSentOn: null,
      sendWhatsApp: async () => "window_closed",
      sendPush: async () => ({ delivered: 0 }),
    });
    expect(outcome).toBe("skipped");
    expect(db.row.last_sent_on).toBeNull();
  });

  it("keeps the day when the push is delivered", async () => {
    const db = reminderAdmin("2026-10-19");
    const outcome = await claimAndDeliverCheckinReminder(db.admin, {
      reminderId: "r1",
      authUserId: "user-1",
      localDate: TODAY,
      previousSentOn: "2026-10-19",
      sendWhatsApp: async () => "not_whatsapp",
      sendPush: async () => ({ delivered: 1 }),
    });
    expect(outcome).toBe("sent");
    expect(db.row.last_sent_on).toBe(TODAY);
  });

  it("releases the claim when the push throws", async () => {
    const db = reminderAdmin("2026-10-19");
    const outcome = await claimAndDeliverCheckinReminder(db.admin, {
      reminderId: "r1",
      authUserId: "user-1",
      localDate: TODAY,
      previousSentOn: "2026-10-19",
      sendWhatsApp: async () => "failed",
      sendPush: async () => {
        throw new Error("push down");
      },
    });
    expect(outcome).toBe("skipped");
    expect(db.row.last_sent_on).toBe("2026-10-19");
  });

  it("does not send again when today is already claimed", async () => {
    const db = reminderAdmin(TODAY);
    let calls = 0;
    const outcome = await claimAndDeliverCheckinReminder(db.admin, {
      reminderId: "r1",
      authUserId: null,
      localDate: TODAY,
      previousSentOn: TODAY,
      sendWhatsApp: async () => {
        calls += 1;
        return "sent";
      },
      sendPush: async () => ({ delivered: 1 }),
    });
    expect(outcome).toBe("skipped");
    expect(calls).toBe(0);
    expect(db.row.last_sent_on).toBe(TODAY);
  });
});
