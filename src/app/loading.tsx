// Root route loading UI (closet). Next streams THIS while the segment's async work resolves, inside the
// layout chrome. A calm, light skeleton in the editorial language — a title placeholder over a soft grid
// of card placeholders. `animate-pulse` is automatically neutralized under prefers-reduced-motion by the
// global rule in globals.css (animation-duration: 0). Pure Server Component, zero env.

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading closet">
      <div className="space-y-3">
        <div className="h-9 w-48 animate-pulse rounded-[var(--radius)] bg-muted/60" />
        <div className="h-4 w-72 animate-pulse rounded-[var(--radius)] bg-muted/40" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="panel aspect-[3/4] animate-pulse bg-muted/30"
          />
        ))}
      </div>
    </div>
  );
}
