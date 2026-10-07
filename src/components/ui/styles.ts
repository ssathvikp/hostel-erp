/**
 * Shared class fragments so every interactive control has the same, clearly
 * visible keyboard focus ring.
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export const fieldBase =
  "block w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand-600";

export function fieldBorder(invalid: boolean) {
  return invalid ? "border-red-500" : "border-slate-300";
}
