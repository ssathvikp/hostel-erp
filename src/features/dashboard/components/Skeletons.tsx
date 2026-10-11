/**
 * Placeholders shaped like the sections they stand in for, so nothing jumps
 * when the data arrives on a slow connection (E8-T1). These sit in in-page
 * Suspense boundaries; there is deliberately no route-level loading.tsx.
 */

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

function TileRow() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <Block className="h-4 w-20" />
          <Block className="mt-2 h-8 w-24" />
          <Block className="mt-1.5 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading key figures">
      <div>
        <Block className="mb-2 h-4 w-20" />
        <TileRow />
      </div>
      <div>
        <Block className="mb-2 h-4 w-14" />
        <TileRow />
      </div>
    </div>
  );
}

export function PanelSkeleton({ height = "h-56" }: { height?: string }) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
      role="status"
      aria-label="Loading"
    >
      <Block className="h-5 w-40" />
      <Block className={`mt-4 w-full ${height}`} />
    </div>
  );
}
