import { notFound } from "next/navigation";
import Link from "next/link";
import { getTrip } from "@/server/app-service";
import { replanTripAction } from "@/app/actions";
import { CAPABILITY_LABELS } from "@/core/capabilities";
import type { CapabilityKey } from "@/core/capabilities";
import type { Severity } from "@/core/recommend";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireUserId } from "@/lib/auth";

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
  const userId = await requireUserId();
  const trip = await getTrip(params.id, userId);
  if (!trip) notFound();

  const result = trip.result;
  const conds = trip.conditions;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <Link
        href="/trips"
        className="data-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-blaze"
      >
        &larr; Saved trips
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
            <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
              Trip&nbsp;/&nbsp;Recommendation
            </span>
          </div>
          <h1 className="heading-display text-3xl tracking-legend text-foreground">{trip.name}</h1>
          <p className="data-mono mt-2 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
            {new Date(trip.createdAt).toLocaleDateString()}
          </p>
          {trip.description && (
            <p className="mt-2 text-sm text-muted-foreground">{trip.description}</p>
          )}
        </div>
        <form action={replanTripAction} className="shrink-0">
          <input type="hidden" name="id" value={trip.id} />
          <Button type="submit" variant="outline" size="sm">
            Re-plan with current closet
          </Button>
        </form>
      </div>

      {/* Conditions summary */}
      <Card>
        <CardHeader><CardTitle className="label-structural text-xs text-foreground">Trip conditions</CardTitle></CardHeader>
        <CardContent>
          <p className="data-mono text-xs leading-relaxed text-muted-foreground">{conditionsSummary(conds)}</p>
        </CardContent>
      </Card>

      {!result ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No recommendation result saved for this trip.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Gap analysis — the signature feature, visual centerpiece */}
          {result.gaps.length > 0 && (
            <Card className="border-l-2 border-l-destructive">
              <CardHeader>
                <CardTitle className="label-structural flex items-center gap-2 text-xs text-foreground">
                  <span className="h-2 w-2 bg-destructive" aria-hidden />
                  Gap analysis — {result.gaps.length} gap{result.gaps.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
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
                      className="flex items-start gap-3 border border-border bg-secondary/40 p-3"
                    >
                      <Badge variant={SEV_VARIANT[gap.severity]} className="mt-0.5 shrink-0">
                        {titleize(gap.severity)}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {CAPABILITY_LABELS[gap.capability as CapabilityKey]}
                        </p>
                        {gap.reason && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{gap.reason}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Verify — items that might satisfy but have unknown deciding facets */}
          {result.uncertain.length > 0 && (
            <Card className="border-l-2 border-l-blaze">
              <CardHeader>
                <CardTitle className="label-structural flex items-center gap-2 text-xs text-foreground">
                  <span className="h-2 w-2 bg-blaze" aria-hidden />
                  Verify — {result.uncertain.length} uncertain
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  You may have gear covering these needs, but a key facet is unknown. Check your
                  item details and correct the facets to get a definitive answer.
                </p>
                <p className="data-mono mt-1 text-[0.625rem] uppercase tracking-wide text-blaze">
                  Correct the unknown facet on an item below, then Re-plan.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.uncertain
                  .slice()
                  .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
                  .map((u) => {
                    // Look up blockedBy from the full outcomes array (Gap[] lacks blockedBy).
                    const outcome = result.outcomes.find((o) => o.capability === u.capability);
                    const blockedBy = outcome?.blockedBy ?? [];
                    return (
                      <div
                        key={u.capability}
                        className="flex items-start gap-3 border border-blaze/40 bg-blaze/[0.07] p-3"
                      >
                        <Badge variant="verify" className="mt-0.5 shrink-0">Verify</Badge>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {CAPABILITY_LABELS[u.capability as CapabilityKey]}
                          </p>
                          {u.reason && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{u.reason}</p>
                          )}
                          {blockedBy.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {blockedBy.map((r) => (
                                <Link
                                  key={r.id}
                                  href={`/items/${r.id}?edit=1`}
                                  className="data-mono text-[0.6875rem] uppercase tracking-wide text-blaze underline-offset-2 hover:underline"
                                >
                                  {r.name}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          )}

          {/* Picks */}
          {result.picks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="label-structural text-xs text-foreground">
                  Picks — {result.picks.length} item{result.picks.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  These items from your closet satisfy at least one required capability.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.picks.map((pick) => (
                  <div
                    key={pick.id}
                    className="flex items-start gap-3 border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/items/${pick.id}`}
                        className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {pick.name}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap gap-1">
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
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No items from your inventory satisfy any required capability for this trip.{" "}
                <Link href="/" className="text-blaze underline-offset-2 hover:underline">
                  View your closet
                </Link>.
              </CardContent>
            </Card>
          )}

          {/* Full outcomes table */}
          <Card>
            <CardHeader>
              <CardTitle className="label-structural text-xs text-foreground">Full capability outcomes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-px bg-border">
                {result.outcomes.map((o) => (
                  <div
                    key={o.capability}
                    className="flex items-start gap-3 bg-card p-2.5"
                  >
                    <div className="w-36 shrink-0">
                      {o.status === "satisfied" && <Badge variant="success">Satisfied</Badge>}
                      {o.status === "uncertain" && <Badge variant="verify">Verify</Badge>}
                      {o.status === "gap" && (
                        <Badge variant={SEV_VARIANT[o.severity]}>{titleize(o.severity)} gap</Badge>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {CAPABILITY_LABELS[o.capability as CapabilityKey]}
                      </p>
                      {o.reason && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{o.reason}</p>
                      )}
                      {o.satisfiedBy.length > 0 && (
                        <p className="data-mono mt-0.5 text-[0.6875rem] text-emerald-700 dark:text-emerald-400">
                          {o.satisfiedBy.map((r) => r.name).join(", ")}
                        </p>
                      )}
                      {o.blockedBy.length > 0 && (
                        <p className="data-mono mt-0.5 text-[0.6875rem] text-blaze">
                          Possible (verify):{" "}
                          {o.blockedBy.map((r, i) => (
                            <span key={r.id}>
                              {i > 0 && ", "}
                              <Link
                                href={`/items/${r.id}?edit=1`}
                                className="underline-offset-2 hover:underline"
                              >
                                {r.name}
                              </Link>
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Links */}
          <div className="flex gap-4 pb-8">
            <Link
              href="/plan"
              className="data-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Plan another trip
            </Link>
            <Link
              href="/"
              className="data-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              Back to closet
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
