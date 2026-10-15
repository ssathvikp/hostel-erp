/** Marks a legal text as awaiting a lawyer's review (E14-T11). */
export function DraftNotice({ version }: { version: string }) {
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Version {version}. Draft awaiting legal review; the final text may differ.
    </p>
  );
}
