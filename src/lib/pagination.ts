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
