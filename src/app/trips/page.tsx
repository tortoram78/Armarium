import Link from "next/link";
import { getTrips } from "@/server/app-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const userId = await requireUserId();
  const trips = await getTrips(userId);

  return (
    <div className="space-y-6">
      {/* Masthead — field-manual section header */}
      <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
            <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
              Log&nbsp;/&nbsp;Saved Plans
            </span>
          </div>
          <h1 className="heading-display text-3xl tracking-legend text-foreground">Saved trips</h1>
          <p className="data-mono mt-2 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            <span className="text-foreground">{trips.length}</span> trip{trips.length === 1 ? "" : "s"} planned
          </p>
        </div>
        <Link
          href="/plan"
          className="label-structural shrink-0 rounded-sm bg-primary px-4 py-2.5 text-[0.6875rem] text-primary-foreground shadow-letterpress transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985] active:shadow-press-in"
        >
          Plan a trip
        </Link>
      </div>

      {trips.length === 0 ? (
        <div className="border border-dashed border-border bg-card/40 px-6 py-16 text-center">
          <p className="label-structural text-sm text-foreground">No trips planned</p>
          <p className="data-mono mt-2 text-xs text-muted-foreground">
            <Link href="/plan" className="text-blaze underline-offset-4 hover:underline">
              Plan your first trip
            </Link>{" "}
            to see gear recommendations and gap analysis.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {trips
            .slice()
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((trip) => {
              const result = trip.result;
              const picks = result?.picks.length ?? 0;
              const gaps = result?.gaps.length ?? 0;
              const uncertain = result?.uncertain.length ?? 0;
              return (
                <Link key={trip.id} href={`/trips/${trip.id}`} className="group">
                  <Card className="h-full transition-colors duration-150 ease-crisp group-hover:border-foreground/40">
                    <CardHeader>
                      <CardTitle className="text-sm text-foreground">{trip.name}</CardTitle>
                      <CardDescription className="data-mono text-[0.625rem] uppercase tracking-wide">
                        {new Date(trip.createdAt).toLocaleDateString()} ·{" "}
                        {trip.conditions.duration} ·{" "}
                        {trip.conditions.exposure}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
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
                  </Card>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
