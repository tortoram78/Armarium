import Link from "next/link";
import { getTrips } from "@/server/app-service";
import { cloneTripAction, deleteTripAction } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { cn } from "@/lib/utils";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const userId = await requireUserId();
  const trips = await getTrips(userId);

  // Real readouts for the HUD rail.
  const totalPicks = trips.reduce((n, t) => n + (t.result?.picks.length ?? 0), 0);
  const totalGaps = trips.reduce((n, t) => n + (t.result?.gaps.length ?? 0), 0);
  const totalVerify = trips.reduce((n, t) => n + (t.result?.uncertain.length ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Masthead — raised machined plate w/ ghosted stencil + HUD status rail */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* big ghosted stencil section number behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-2 -top-6 text-[7.5rem] sm:text-[9rem]"
          aria-hidden
        >
          04
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
                Log&nbsp;·&nbsp;Saved Plans
              </span>
            </div>
            <h1 className="heading-display text-stamped text-4xl tracking-legend text-foreground sm:text-5xl">
              Saved trips
            </h1>
          </div>

          <Link
            href="/plan"
            className={cn(
              "group surface-bezel flex shrink-0 items-center gap-2 px-4 py-2.5",
              "label-structural text-stamped text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))]",
              "transition-[transform,filter,box-shadow] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985] active:shadow-pressed",
            )}
          >
            Plan a trip
          </Link>
        </div>

        {/* ── HUD status rail (recessed strip, real readouts) ── */}
        <div className="surface-well relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
          <span className="hud-readout text-[0.625rem] tracking-[0.18em] text-foreground/80">
            N=<span className="text-foreground">{String(trips.length).padStart(2, "0")}</span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            PICKS&nbsp;<span className="text-foreground/85">{String(totalPicks).padStart(2, "0")}</span>
          </span>
          {totalGaps > 0 && (
            <>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.18em] text-foreground/80">
                GAPS&nbsp;<span className="text-foreground/85">{String(totalGaps).padStart(2, "0")}</span>
              </span>
            </>
          )}
          {totalVerify > 0 && (
            <>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span className="hud-readout flex items-center gap-1.5 text-[0.625rem] tracking-[0.18em] text-blaze">
                <span className="hud-pip" aria-hidden />
                {String(totalVerify).padStart(2, "0")}&nbsp;VERIFY
              </span>
            </>
          )}
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="surface-well px-6 py-16 text-center">
          <p className="label-structural text-stamped text-sm text-foreground">No trips planned</p>
          <p className="data-mono mt-2 text-xs text-muted-foreground">
            <Link href="/plan" className="text-blaze underline-offset-4 hover:underline">
              Plan your first trip
            </Link>{" "}
            to see gear recommendations and gap analysis.
          </p>
        </div>
      ) : (
        /* Saved plans index — sits DOWN in a recessed well */
        <section className="surface-well p-3 sm:p-4">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">
              SEC·01
            </span>
            <h2 className="label-structural text-stamped text-xs text-foreground">Planned trips</h2>
            <span className="h-px flex-1 bg-seam/40" aria-hidden />
            <span className="data-mono text-[0.625rem] tabular-nums text-muted-foreground">
              {String(trips.length).padStart(2, "0")}
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {trips
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((trip, idx) => {
                const result = trip.result;
                const picks = result?.picks.length ?? 0;
                const gaps = result?.gaps.length ?? 0;
                const uncertain = result?.uncertain.length ?? 0;
                return (
                  // Card is a container (not a link) so the per-row CRUD forms aren't nested in an <a>.
                  // A stretched-link overlay makes the whole body navigate; the action rail sits above it.
                  <Card
                    key={trip.id}
                    variant="bezel"
                    className="group relative flex h-full flex-col transition-[filter] duration-150 ease-crisp hover:brightness-[1.06]"
                  >
                    {gaps > 0 && (
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-destructive" aria-hidden />
                    )}
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm text-foreground">
                          <Link
                            href={`/trips/${trip.id}`}
                            className="relative z-[1] underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:underline"
                          >
                            {trip.name}
                          </Link>
                        </CardTitle>
                        <span className="hud-readout relative z-[1] shrink-0 text-[0.5625rem] leading-none text-hud/70">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <CardDescription className="data-mono text-[0.625rem] uppercase tracking-wide">
                        {new Date(trip.createdAt).toLocaleDateString()} ·{" "}
                        {trip.conditions.duration} ·{" "}
                        {trip.conditions.exposure}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <div className="flex flex-wrap gap-1.5">
                        {result ? (
                          <>
                            <Badge variant="success">{picks} pick{picks !== 1 ? "s" : ""}</Badge>
                            {gaps > 0 && (
                              <Badge variant="critical">{gaps} gap{gaps !== 1 ? "s" : ""}</Badge>
                            )}
                            {uncertain > 0 && (
                              <Badge variant="verify">{uncertain} verify</Badge>
                            )}
                          </>
                        ) : (
                          <Badge variant="subtle">No result</Badge>
                        )}
                      </div>
                      {trip.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {trip.description}
                        </p>
                      )}
                    </CardContent>

                    {/* Per-row CRUD rail — above the stretched link (z-index) so the controls stay clickable. */}
                    <div className="relative z-[1] flex items-center gap-1 border-t border-seam/40 px-3 py-1.5">
                      <form action={cloneTripAction} className="contents">
                        <input type="hidden" name="id" value={trip.id} />
                        <SubmitButton pendingText="…" className="h-7 px-2 text-[0.625rem]">
                          Clone
                        </SubmitButton>
                      </form>
                      <form action={deleteTripAction} className="contents">
                        <input type="hidden" name="id" value={trip.id} />
                        <ConfirmButton
                          message={`Delete "${trip.name}"? This removes the trip and its recommendation.`}
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[0.625rem] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          Delete
                        </ConfirmButton>
                      </form>
                    </div>
                  </Card>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
