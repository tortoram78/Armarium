import Link from "next/link";
import { getTrips } from "@/server/app-service";
import { cloneTripAction, deleteTripAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const userId = await requireUserId();
  const trips = await getTrips(userId);

  const totalGaps = trips.reduce((n, t) => n + (t.result?.gaps.length ?? 0), 0);
  const totalVerify = trips.reduce((n, t) => n + (t.result?.uncertain.length ?? 0), 0);

  return (
    <div className="space-y-10">
      {/* ── Masthead ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-2xl">
          <p className="eyebrow mb-3">Saved plans</p>
          <h1 className="display-xl text-foreground">Trips</h1>
          <p className="mt-4 max-w-xl text-[0.975rem] leading-relaxed text-muted-foreground">
            {trips.length === 0 ? (
              "No trips yet — plan one to see gear recommendations and gap analysis."
            ) : (
              <>
                {trips.length} planned {trips.length === 1 ? "trip" : "trips"}.
                {totalGaps > 0 && (
                  <> {totalGaps} {totalGaps === 1 ? "gap" : "gaps"} across them.</>
                )}
                {totalVerify > 0 && (
                  <> {totalVerify} to verify.</>
                )}
              </>
            )}
          </p>
        </div>

        <Link
          href="/plan"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92 active:translate-y-px"
        >
          Plan a trip
        </Link>
      </header>

      {trips.length === 0 ? (
        /* ── Empty state ── */
        <div className="panel flex flex-col items-center justify-center px-6 py-20 text-center">
          <h2 className="display-md text-foreground">No trips planned</h2>
          <p className="mt-3 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
            Plan your first trip and Armarium will recommend what to pack, flag any gaps, and surface gear
            worth a second look.
          </p>
          <Link
            href="/plan"
            className="mt-7 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
          >
            Plan your first trip
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {trips
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((trip) => {
              const result = trip.result;
              const picks = result?.picks.length ?? 0;
              const gaps = result?.gaps.length ?? 0;
              const uncertain = result?.uncertain.length ?? 0;
              return (
                // Card is a container (not a link) so the per-row CRUD forms aren't nested in an <a>.
                // A stretched-link overlay makes the body navigate; the action rail sits above it (z-index).
                <div
                  key={trip.id}
                  className="panel panel-hover group relative flex h-full flex-col p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="display-md text-foreground transition-colors group-hover:text-primary">
                      <Link
                        href={`/trips/${trip.id}`}
                        className="relative z-[1] after:absolute after:inset-0 after:content-['']"
                      >
                        {trip.name}
                      </Link>
                    </h2>
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground">
                    <span className="data-mono text-[0.8125rem]">
                      {new Date(trip.createdAt).toLocaleDateString()}
                    </span>
                    {" · "}
                    {trip.conditions.duration.replace(/_/g, " ")}
                    {" · "}
                    {trip.conditions.exposure.replace(/_/g, " ")}
                  </p>

                  {trip.description && (
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {trip.description}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {result ? (
                      <>
                        <Badge variant="success">{picks} pick{picks !== 1 ? "s" : ""}</Badge>
                        {gaps > 0 && (
                          <Badge variant="critical">{gaps} gap{gaps !== 1 ? "s" : ""}</Badge>
                        )}
                        {uncertain > 0 && <Badge variant="verify">{uncertain} verify</Badge>}
                      </>
                    ) : (
                      <Badge variant="subtle">No result</Badge>
                    )}
                  </div>

                  {/* Per-row CRUD rail — above the stretched link (z-index) so controls stay clickable. */}
                  <div className="relative z-[1] mt-5 flex items-center gap-2 border-t border-border pt-4">
                    <form action={cloneTripAction} className="contents">
                      <input type="hidden" name="id" value={trip.id} />
                      <SubmitButton pendingText="…" className="h-9 px-3.5 text-[0.8125rem]">
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
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Delete
                      </ConfirmButton>
                    </form>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
