/** Fixed lines for a number that sits on two profiles. No clinical content. */

export const PHONE_CLASH_PATIENT =
  "This number is on more than one profile. Someone at the practice will sort that out. I have not saved this onto a chart.";

export function phoneClashOwnerMessage(names: string[]): string {
  const shown = names.map((n) => n.trim()).filter(Boolean).slice(0, 4);
  const count = Math.max(shown.length, 2);
  const list = shown.length ? shown.join(" and ") : "two profiles";
  return `${count} profiles share one cellphone: ${list}. Buddy did not choose one. Please merge them before today's answers can be saved.`;
}
