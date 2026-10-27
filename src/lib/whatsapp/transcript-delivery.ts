/** Latest provider status wins. A refused API call is still "not delivered". */
export function outboundFailed(
  sentOk: boolean,
  latestStatus: string | null | undefined,
): boolean {
  if (latestStatus === "failed") return true;
  if (latestStatus === "delivered" || latestStatus === "read" || latestStatus === "sent") return false;
  return sentOk === false;
}

export function latestStatusByMessage(
  rows: Array<{ provider_message_id: string; status: string; occurred_at: string }>,
): Map<string, string> {
  const out = new Map<string, { status: string; at: string }>();
  for (const row of rows) {
    const prev = out.get(row.provider_message_id);
    if (!prev || row.occurred_at >= prev.at) {
      out.set(row.provider_message_id, { status: row.status, at: row.occurred_at });
    }
  }
  return new Map([...out.entries()].map(([id, row]) => [id, row.status]));
}
