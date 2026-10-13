import type { PostgrestError } from "@supabase/supabase-js";

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

/** PostgREST's `max_rows` (supabase/config.toml): no response holds more rows. */
export const API_MAX_ROWS = 1000;

/**
 * Every row of a query that can return more than the API's row cap, which
 * otherwise truncates silently. `page` builds the query for one range; it
 * must have a total order (end with a unique column) so pages never skip or
 * repeat a row.
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += API_MAX_ROWS) {
    const { data, error } = await page(from, from + API_MAX_ROWS - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < API_MAX_ROWS) return rows;
  }
}
