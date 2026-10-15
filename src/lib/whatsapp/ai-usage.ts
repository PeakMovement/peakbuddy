/**
 * Counts model calls for the job heartbeat. Tokens and HTTP status only.
 * Never a prompt, a reply, or a patient message.
 */

export interface AiCallNote {
  model: string;
  status: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface Bucket {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

const buckets = new Map<string, Bucket>();

export function noteAiCall(note: AiCallNote): void {
  const row = buckets.get(note.model) ?? { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  row.calls += 1;
  if (note.status < 200 || note.status >= 300) row.failed += 1;
  row.inputTokens += note.inputTokens ?? 0;
  row.outputTokens += note.outputTokens ?? 0;
  buckets.set(note.model, row);
}

export function takeAiUsage(): string | null {
  if (!buckets.size) return null;
  const parts = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, row]) => {
      return `${model} calls=${row.calls} failed=${row.failed} in=${row.inputTokens} out=${row.outputTokens}`;
    });
  buckets.clear();
  return parts.join("; ").slice(0, 500);
}

export function resetAiUsage(): void {
  buckets.clear();
}
