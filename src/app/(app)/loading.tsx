import { Spinner } from "@/components/ui";

/** Standard loading state for every page inside the app shell. */
export default function Loading() {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-24 text-slate-500">
      <Spinner className="size-6" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
