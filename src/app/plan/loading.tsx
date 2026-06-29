// /plan loading UI. A calm, centered cue in the editorial language while the trip planner form's async
// work resolves. `animate-pulse` is neutralized under prefers-reduced-motion by the global rule in
// globals.css. Pure Server Component, zero env.

export default function Loading() {
  return (
    <div
      className="flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center gap-4 px-4 py-12 text-center"
      aria-busy="true"
      aria-label="Loading the trip planner"
    >
      <p className="eyebrow text-accent">Plan a trip</p>
      <div className="h-3 w-28 animate-pulse rounded-full bg-muted/60" />
      <p className="text-sm text-muted-foreground">Getting your planner ready&hellip;</p>
    </div>
  );
}
