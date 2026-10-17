/**
 * Whether a paged query asked for a page that starts after the last row.
 * PostgREST answers that with HTTP 416 rather than an empty page, and it
 * happens in normal use: a stale link, or acting on the last row of the
 * last page so that page no longer exists. Pages send the user back to the
 * first page instead of failing.
 */
export function isPastLastPage(error: { code?: string } | null): boolean {
  return error?.code === "PGRST103";
}

/** PostgREST's row cap (`max_rows` in supabase/config.toml, same when hosted). */
export const API_MAX_ROWS = 1000;

/**
 * Reads every row of a query that can grow past the API's row cap, one
 * page at a time. `page(from, to)` must build the same query each time
 * with `.range(from, to)` and an ordering that ends in a unique column,
 * so no row is skipped or repeated between pages.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = API_MAX_ROWS,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
