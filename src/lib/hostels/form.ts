import "server-only";

import { getHostelContext } from "./active";

export const NO_HOSTEL = "Finish setting up your hostel first.";
export const HOSTEL_CHANGED =
  "You switched to a different hostel in another tab. Reload this page and try again.";

/**
 * The hostel a submitted form may change: the active hostel, but only if it
 * is the one the form was shown for (the `hostel_id` posted by
 * `HostelField`). Otherwise the save is refused rather than written into
 * whichever hostel happens to be selected now.
 */
export async function formHostel(
  posted: FormData | string | null | undefined,
): Promise<{ id: string } | { error: string }> {
  const active = (await getHostelContext()).active;
  if (!active) return { error: NO_HOSTEL };
  const value = posted instanceof FormData ? posted.get("hostel_id") : posted;
  if (value !== active.id) return { error: HOSTEL_CHANGED };
  return { id: active.id };
}
