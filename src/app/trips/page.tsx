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
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saved trips</h1>
          <p className="text-sm text-neutral-500">
            {trips.length} trip{trips.length === 1 ? "" : "s"} planned.
          </p>
        </div>
        <Link
          href="/plan"
          className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Plan a trip
        </Link>
      </div>

      {trips.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-neutral-500">
            No trips planned yet.{" "}
            <Link href="/plan" className="underline">
              Plan your first trip
            </Link>{" "}
            to see gear recommendations and gap analysis.
          </CardContent>
        </Card>
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
                <Link key={trip.id} href={`/trips/${trip.id}`}>
                  <Card className="h-full transition hover:border-neutral-400">
                    <CardHeader>
                      <CardTitle className="text-base">{trip.name}</CardTitle>
                      <CardDescription>
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
                        <p className="mt-2 text-xs text-neutral-500 line-clamp-2">
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
