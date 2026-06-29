// /trips loading UI. A calm, light skeleton in the editorial language — a title placeholder over a few
// saved-trip row placeholders — while the segment's async work resolves. `animate-pulse` is neutralized
// under prefers-reduced-motion by the global rule in globals.css. Pure Server Component, zero env.

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading saved trips">
      <div className="space-y-3">
        <div className="h-9 w-44 animate-pulse rounded-[var(--radius)] bg-muted/60" />
        <div className="h-4 w-64 animate-pulse rounded-[var(--radius)] bg-muted/40" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel h-20 animate-pulse bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
