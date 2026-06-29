// /plan/preview loading UI — this is the heaviest route (the packing checklist is computed by reasoning
// over the closet against the trip conditions). A calm skeleton in the editorial language: a title cue
// over a few row placeholders standing in for the checklist. `animate-pulse` is neutralized under
// prefers-reduced-motion by the global rule in globals.css. Pure Server Component, zero env.

export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Building your packing checklist">
      <div className="space-y-3 text-center">
        <p className="eyebrow text-accent">Packing checklist</p>
        <div className="mx-auto h-8 w-64 animate-pulse rounded-[var(--radius)] bg-muted/60" />
        <p className="text-sm text-muted-foreground">Reasoning over your gear&hellip;</p>
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="panel flex animate-pulse items-center gap-4 px-4 py-4"
          >
            <div className="h-10 w-10 shrink-0 rounded-[var(--radius)] bg-muted/50" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded-[var(--radius)] bg-muted/50" />
              <div className="h-3 w-1/3 rounded-[var(--radius)] bg-muted/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
