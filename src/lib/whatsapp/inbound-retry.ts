/** Attempt count lives in failure_reason until a column is worth it. No message text. */

export const INBOUND_ATTEMPT_CAP = 3;
export const INBOUND_QUEUE_JOB = "whatsapp-inbound-dead";

export function attemptOf(reason: string | null | undefined): number {
  const match = /^retry:(\d+)/.exec(String(reason ?? ""));
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function retryReason(previous: string | null | undefined, message: string): string {
  const next = attemptOf(previous) + 1;
  const clean = message.replace(/[\r\n]+/g, " ").slice(0, 160);
  return `retry:${next}|${clean}`;
}

export function canRetry(reason: string | null | undefined): boolean {
  const n = attemptOf(reason);
  return n >= 1 && n < INBOUND_ATTEMPT_CAP;
}

export function hitRetryCap(reason: string | null | undefined): boolean {
  return attemptOf(reason) >= INBOUND_ATTEMPT_CAP;
}

/** Health-mail detail. Counts only. Never the patient's words. */
export function inboundQueueDetail(dead: number, staleSaved: number, staleUnsaved: number): string {
  const parts: string[] = [];
  if (dead > 0) {
    parts.push(
      `${dead} inbound message${dead === 1 ? "" : "s"} still failed after ${INBOUND_ATTEMPT_CAP} attempts`,
    );
  }
  if (staleSaved > 0) {
    parts.push(
      `${staleSaved} stale inbound message${staleSaved === 1 ? "" : "s"} saved as a partial check-in, rest ignored`,
    );
  }
  if (staleUnsaved > 0) {
    parts.push(
      `${staleUnsaved} stale inbound message${staleUnsaved === 1 ? "" : "s"} ignored with nothing saved`,
    );
  }
  return parts.join("; ").slice(0, 500);
}
