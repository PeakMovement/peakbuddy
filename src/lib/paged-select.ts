/**
 * PostgREST caps every response at the project's max-rows (1000 by default)
 * and does so silently. fetchAllPages walks a query in fixed-size ranges so a
 * windowed read returns every row, with a hard ceiling so a runaway table
 * can't turn one request into thousands.
 *
 * `page(from, to)` must build a fresh, deterministically ordered query and
 * apply `.range(from, to)` to it.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; truncated: boolean; error: unknown }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 20_000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await page(from, to);
    if (error) return { rows, truncated: false, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < to - from + 1) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}
