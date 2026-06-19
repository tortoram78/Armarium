import { notFound } from "next/navigation";
import Link from "next/link";
import { getTrip } from "@/server/app-service";
import { CAPABILITY_LABELS } from "@/core/capabilities";
import type { CapabilityKey } from "@/core/capabilities";
import type { Severity } from "@/core/recommend";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map severity to badge variant
const SEV_VARIANT: Record<Severity, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

// Severity order for sorting (most severe first)
const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function conditionsSummary(c: {
  temp_min_c: number | null;
  temp_max_c: number | null;
  precipitation: string;
  wind: string;
  sun: string;
  exertion: string;
  duration: string;
  exposure: string;
  activities: string[];
}) {
  const parts: string[] = [];
  if (c.temp_min_c !== null && c.temp_max_c !== null) {
    parts.push(`${c.temp_min_c}–${c.temp_max_c}°C`);
  } else if (c.temp_min_c !== null) {
    parts.push(`Low ${c.temp_min_c}°C`);
  } else if (c.temp_max_c !== null) {
    parts.push(`High ${c.temp_max_c}°C`);
  }
  parts.push(titleize(c.precipitation) + " precip");
  parts.push(titleize(c.wind) + " wind");
  parts.push(titleize(c.sun) + " sun");
  parts.push(titleize(c.exertion) + " exertion");
  parts.push(titleize(c.duration));
  parts.push(titleize(c.exposure));
  if (c.activities.length > 0) parts.push(c.activities.map(titleize).join(", "));
  return parts.join(" · ");
}

export default async function TripDetailPage({ params }: { params: { id: string } }) {
  const trip = await getTrip(params.id);
  if (!trip) notFound();

  const result = trip.result;
  const conds = trip.conditions;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <Link href="/trips" className="text-xs text-neutral-500 hover:underline">
        &larr; Saved trips
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{trip.name}</h1>
        <p className="mt-1 text-xs text-neutral-500">
          {new Date(trip.createdAt).toLocaleDateString()}
        </p>
        {trip.description && (
          <p className="mt-1 text-sm text-neutral-600">{trip.description}</p>
        )}
      </div>

      {/* Conditions summary */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Trip conditions</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-neutral-600">{conditionsSummary(conds)}</p>
        </CardContent>
      </Card>

      {!result ? (
        <Card>
          <CardContent className="p-8 text-center text-neutral-500 text-sm">
            No recommendation result saved for this trip.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Gap analysis — the signature feature, visual centerpiece */}
          {result.gaps.length > 0 && (
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-base text-red-800">
                  Gap analysis — {result.gaps.length} gap{result.gaps.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-red-700">
                  Your closet is missing gear to cover these required capabilities. Address critical
                  and high gaps before the trip.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.gaps
                  .slice()
                  .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
                  .map((gap) => (
                    <div
                      key={gap.capability}
                      className="flex items-start gap-3 rounded-md border border-neutral-100 bg-neutral-50 p-3"
                    >
                      <Badge variant={SEV_VARIANT[gap.severity]} className="shrink-0 mt-0.5">
                        {titleize(gap.severity)}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">
                          {CAPABILITY_LABELS[gap.capability as CapabilityKey]}
                        </p>
                        {gap.reason && (
                          <p className="text-xs text-neutral-500 mt-0.5">{gap.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Verify — items that might satisfy but have unknown deciding facets */}
          {result.uncertain.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-base text-amber-800">
                  Verify — {result.uncertain.length} uncertain
                </CardTitle>
                <p className="text-xs text-amber-700">
                  You may have gear covering these needs, but a key facet is unknown. Check your
                  item details and correct the facets to get a definitive answer.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.uncertain
                  .slice()
                  .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
                  .map((u) => (
                    <div
                      key={u.capability}
                      className="flex items-start gap-3 rounded-md border border-amber-100 bg-amber-50 p-3"
                    >
                      <Badge variant="verify" className="shrink-0 mt-0.5">Verify</Badge>
                      <div>
                        <p className="text-sm font-medium">
                          {CAPABILITY_LABELS[u.capability as CapabilityKey]}
                        </p>
                        {u.reason && (
                          <p className="text-xs text-amber-700 mt-0.5">{u.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Picks */}
          {result.picks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Picks — {result.picks.length} item{result.picks.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-neutral-500">
                  These items from your closet satisfy at least one required capability.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.picks.map((pick) => (
                  <div
                    key={pick.id}
                    className="flex items-start gap-3 rounded-md border border-neutral-100 p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/items/${pick.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {pick.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {pick.capabilities.map((cap) => (
                          <Badge key={cap} variant="success">
                            {CAPABILITY_LABELS[cap as CapabilityKey]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-neutral-500">
                No items from your inventory satisfy any required capability for this trip.{" "}
                <Link href="/" className="underline">
                  View your closet
                </Link>.
              </CardContent>
            </Card>
          )}

          {/* Full outcomes table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Full capability outcomes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {result.outcomes.map((o) => (
                  <div
                    key={o.capability}
                    className="flex items-start gap-3 rounded border border-neutral-100 p-2.5"
                  >
                    <div className="w-36 shrink-0">
                      {o.status === "satisfied" && <Badge variant="success">Satisfied</Badge>}
                      {o.status === "uncertain" && <Badge variant="verify">Verify</Badge>}
                      {o.status === "gap" && (
                        <Badge variant={SEV_VARIANT[o.severity]}>{titleize(o.severity)} gap</Badge>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">
                        {CAPABILITY_LABELS[o.capability as CapabilityKey]}
                      </p>
                      {o.reason && (
                        <p className="text-xs text-neutral-400 mt-0.5">{o.reason}</p>
                      )}
                      {o.satisfiedBy.length > 0 && (
                        <p className="text-xs text-green-700 mt-0.5">
                          {o.satisfiedBy.map((r) => r.name).join(", ")}
                        </p>
                      )}
                      {o.blockedBy.length > 0 && (
                        <p className="text-xs text-amber-700 mt-0.5">
                          Possible (verify): {o.blockedBy.map((r) => r.name).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Links */}
          <div className="flex gap-4 text-sm pb-8">
            <Link href="/plan" className="underline text-neutral-600 hover:text-neutral-900">
              Plan another trip
            </Link>
            <Link href="/" className="underline text-neutral-600 hover:text-neutral-900">
              Back to closet
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
