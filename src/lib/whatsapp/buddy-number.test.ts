import { afterEach, describe, expect, it } from "vitest";
import { BUDDY_WHATSAPP_NUMBER, buddyWhatsappChatUrl, buddyWhatsappNumber } from "./buddy-number";

const PREV = process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER;

afterEach(() => {
  if (PREV === undefined) delete process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER;
  else process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER = PREV;
});

describe("buddy WhatsApp line", () => {
  it("defaults to the current Buddy line", () => {
    delete process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER;
    expect(BUDDY_WHATSAPP_NUMBER).toBe("27715516294");
    expect(buddyWhatsappNumber()).toBe("27715516294");
    expect(buddyWhatsappChatUrl()).toBe("https://wa.me/27715516294");
  });

  it("uses the env var when it is set, digits only", () => {
    process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER = "+27 82 000 1111";
    expect(buddyWhatsappNumber()).toBe("27820001111");
    expect(buddyWhatsappChatUrl("Hi")).toBe("https://wa.me/27820001111?text=Hi");
  });

  it("ignores a blank override", () => {
    process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER = "  ";
    expect(buddyWhatsappNumber()).toBe("27715516294");
  });
});
