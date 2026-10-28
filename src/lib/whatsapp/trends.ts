/**
 * Quiet trend signals for the physio (28 Oct 2026, Justin: "quiet signal").
 *
 * Shown on the client's status and in the Monday summary as "worth a look".
 * Never a push, never a red flag, never sent to the patient. Signals, not
 * diagnoses. The two rules are Justin's:
 *   1. Pain went up at each of the last 3 check-ins, by 2+ points in total.
 *   2. Sleep and energy both dropped by 2+ over the past 7 days.
 * Changing either rule needs Justin's yes.
 */

export interface TrendPoint {
  at: string;
  pain: number | null;
  sleep: number | null;
  energy: number | null;
}

export interface TrendSignal {
  rule: "pain_rising" | "sleep_energy_down";
  text: string;
}

const DAY = 86_400_000;
export const PAIN_RISES = 3;
export const PAIN_TOTAL = 2;
export const SLEEP_ENERGY_DROP = 2;
export const SLEEP_ENERGY_DAYS = 7;

export function trendSignal(points: TrendPoint[], now: Date): TrendSignal | null {
  const asc = [...points].sort((a, b) => a.at.localeCompare(b.at));

  const pains = asc.filter((p) => p.pain != null).map((p) => p.pain as number);
  if (pains.length >= PAIN_RISES + 1) {
    const tail = pains.slice(-(PAIN_RISES + 1));
    const rising = tail.every((v, i) => i === 0 || v > tail[i - 1]);
    if (rising && tail[tail.length - 1] - tail[0] >= PAIN_TOTAL) {
      return {
        rule: "pain_rising",
        text: `pain has gone up at each of the last ${PAIN_RISES} check-ins (${tail.join(" → ")}).`,
      };
    }
  }

  const week = asc.filter(
    (p) =>
      now.getTime() - new Date(p.at).getTime() <= SLEEP_ENERGY_DAYS * DAY &&
      p.sleep != null &&
      p.energy != null,
  );
  if (week.length >= 2) {
    const first = week[0];
    const last = week[week.length - 1];
    const ds = (first.sleep as number) - (last.sleep as number);
    const de = (first.energy as number) - (last.energy as number);
    if (ds >= SLEEP_ENERGY_DROP && de >= SLEEP_ENERGY_DROP) {
      return {
        rule: "sleep_energy_down",
        text: `sleep and energy have both dropped this week (sleep ${first.sleep} → ${last.sleep}, energy ${first.energy} → ${last.energy}).`,
      };
    }
  }
  return null;
}
