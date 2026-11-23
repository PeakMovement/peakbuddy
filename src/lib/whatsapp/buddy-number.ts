/**
 * The WhatsApp line clients open when a link sends them to Buddy.
 *
 * This is a wa.me display number, not the Meta sender. Outbound messages use
 * META_PHONE_NUMBER_ID (or TWILIO_WHATSAPP_FROM). Do not point those at this.
 *
 * BUDDY_BACK_TO_WHATSAPP_NUMBER overrides the digits (country code, no plus).
 * When it is unset, links stay on Buddy's current line.
 */

export const BUDDY_WHATSAPP_NUMBER = "27715516294";

export function buddyWhatsappNumber(
  raw: string | null | undefined = process.env.BUDDY_BACK_TO_WHATSAPP_NUMBER,
): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits || BUDDY_WHATSAPP_NUMBER;
}

/** https://wa.me/<digits>, with an optional prefilled message. */
export function buddyWhatsappChatUrl(text?: string): string {
  const base = `https://wa.me/${buddyWhatsappNumber()}`;
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}
