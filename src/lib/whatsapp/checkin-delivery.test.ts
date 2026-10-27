import { describe, expect, it } from "vitest";
import {
  CHECKIN_NOTE_FAILED,
  CHECKIN_NOTE_WINDOW,
  formatDeliveryReply,
  isCheckinDeliveryAsk,
  shouldAlertDelivery,
  summariseDelivery,
} from "./checkin-delivery";

const DATE = "2026-10-27";

describe("check-in delivery summary", () => {
  it("recognises the admin question", () => {
    expect(isCheckinDeliveryAsk("did check-ins go out")).toBe(true);
    expect(isCheckinDeliveryAsk("Did the check-ins go out?")).toBe(true);
    expect(isCheckinDeliveryAsk("check-in status")).toBe(true);
    expect(isCheckinDeliveryAsk("how is Sam doing")).toBe(false);
  });

  it("counts sent, failed, window closed, and replies for today only", () => {
    const summary = summariseDelivery({
      date: DATE,
      weekday: 2,
      minuteOfDay: 19 * 60,
      reminders: [
        { clientId: "a", name: "Amahle", days: [2], time: "18:00", lastSentOn: DATE },
        { clientId: "b", name: "Ben", days: [2], time: "18:00", lastSentOn: null },
        { clientId: "c", name: "Cara", days: [2], time: "18:00", lastSentOn: null },
        { clientId: "d", name: "Dee", days: [1], time: "18:00", lastSentOn: null },
      ],
      outbound: [
        {
          clientId: "a",
          body: "Time for a quick check-in.",
          sentOk: true,
          at: "2026-10-27T16:00:00Z",
        },
        { clientId: "b", body: CHECKIN_NOTE_WINDOW, sentOk: false, at: "2026-10-27T16:01:00Z" },
        { clientId: "c", body: CHECKIN_NOTE_FAILED, sentOk: false, at: "2026-10-27T16:02:00Z" },
        { clientId: "a", body: "old", sentOk: true, at: "2026-10-26T16:00:00Z" },
      ],
      inbound: [{ clientId: "a", body: "4", sentOk: true, at: "2026-10-27T16:05:00Z" }],
    });
    expect(summary.due).toBe(3);
    expect(summary.sent).toBe(1);
    expect(summary.windowClosed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.replied).toBe(1);
    expect(formatDeliveryReply(summary)).toMatch(
      /3 due, 1 sent, 1 failed, 1 window closed, 1 replied/,
    );
    expect(formatDeliveryReply(summary)).toMatch(/Ben: window closed/);
  });

  it("alerts only when someone was due and nobody was delivered, once", () => {
    expect(shouldAlertDelivery({ undelivered: 2, delivered: 0, alreadyAlerted: false })).toBe(true);
    expect(shouldAlertDelivery({ undelivered: 2, delivered: 1, alreadyAlerted: false })).toBe(
      false,
    );
    expect(shouldAlertDelivery({ undelivered: 0, delivered: 0, alreadyAlerted: false })).toBe(
      false,
    );
    expect(shouldAlertDelivery({ undelivered: 2, delivered: 0, alreadyAlerted: true })).toBe(false);
  });
});
