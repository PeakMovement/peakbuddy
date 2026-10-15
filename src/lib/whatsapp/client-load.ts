/** A client row is kept only when its id is the one already on the conversation. */

export function acceptClientRow<T extends { id?: string | null }>(
  requestedId: string,
  row: T | null | undefined,
): T | null {
  if (!requestedId || !row?.id || row.id !== requestedId) return null;
  return row;
}

export interface SelectResult<T> {
  data: T | null;
  error: { code?: string } | null;
}

/**
 * A missing column fails the wide select. Fall back, log the code, and do
 * not treat that failure as "this number is unknown".
 */
export function resolveLinkedClient<T extends { id?: string | null }>(
  requestedId: string,
  primary: SelectResult<T>,
  fallback: SelectResult<T> | null,
): { client: T | null; outcome: "ok" | "missing" | "unreadable" } {
  if (!primary.error) {
    const client = acceptClientRow(requestedId, primary.data);
    return client ? { client, outcome: "ok" } : { client: null, outcome: "missing" };
  }
  const client = fallback && !fallback.error ? acceptClientRow(requestedId, fallback.data) : null;
  if (client) return { client, outcome: "ok" };
  return { client: null, outcome: "unreadable" };
}
