import { notFound } from "next/navigation";
import Link from "next/link";
import { getTrip } from "@/server/app-service";
import {
  replanTripAction,
  renameTripAction,
  cloneTripAction,
  deleteTripAction,
  updateTripConditionsAction,
} from "@/app/actions";
import { CAPABILITY_LABELS } from "@/core/capabilities";
import type { CapabilityKey } from "@/core/capabilities";
import type { Severity } from "@/core/recommend";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TripControls } from "@/components/TripControls";
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

export default async function TripDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | undefined>;
}) {
  const userId = await requireUserId();
  const trip = await getTrip(params.id, userId);
  if (!trip) notFound();

  const result = trip.result;
  const conds = trip.conditions;

  const picksCount = result?.picks.length ?? 0;
  const gapsCount = result?.gaps.length ?? 0;
  const verifyCount = result?.uncertain.length ?? 0;
  // Capabilities covered by a multi-item layering SYSTEM (vs. a single item) — surfaced distinctly.
  const systemOutcomes = (result?.outcomes ?? []).filter(
    (o) => o.satisfiedBy.length === 0 && o.satisfiedBySystem.length > 0,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <Link
        href="/trips"
        className="hud-readout inline-flex items-center gap-1.5 text-[0.625rem] tracking-[0.16em] transition-colors hover:text-blaze"
      >
        <span aria-hidden>&larr;</span> Trips&nbsp;/&nbsp;Log
      </Link>

      {/* Header — raised dossier plate with ghosted stencil + HUD readout */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* ghosted stencil trip code behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-1 -top-5 text-[6rem] sm:text-[7rem]"
          aria-hidden
        >
          {trip.id.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TRP"}
        </span>
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
                Trip&nbsp;·&nbsp;Recommendation
              </span>
            </div>
            <h1 className="heading-display text-stamped text-3xl tracking-legend text-foreground sm:text-4xl">{trip.name}</h1>
            <p className="hud-readout mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] tracking-[0.15em]">
              <span>ADD&nbsp;<span className="text-foreground/85">{new Date(trip.createdAt).toLocaleDateString()}</span></span>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span>PICKS&nbsp;<span className="text-foreground/85">{String(picksCount).padStart(2, "0")}</span></span>
              {gapsCount > 0 && (
                <>
                  <span className="h-3 w-px bg-seam/60" aria-hidden />
                  <span>GAPS&nbsp;<span className="text-foreground/85">{String(gapsCount).padStart(2, "0")}</span></span>
                </>
              )}
              {verifyCount > 0 && (
                <span className="flex items-center gap-1 text-blaze">
                  <span className="hud-pip" aria-hidden />{String(verifyCount).padStart(2, "0")}&nbsp;VERIFY
                </span>
              )}
            </p>
            {trip.description && (
              <p className="relative mt-2 max-w-prose text-sm text-muted-foreground">{trip.description}</p>
            )}
          </div>
          <form action={replanTripAction} className="shrink-0">
            <input type="hidden" name="id" value={trip.id} />
            <Button type="submit" variant="outline" size="sm">
              Re-plan with current closet
            </Button>
          </form>
        </div>

        {/* ── Trip controls (rename / edit conditions / clone / delete) — recessed action rail ── */}
        <div className="surface-well relative mt-4 p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">CTRL</span>
            <span className="h-px flex-1 bg-seam/40" aria-hidden />
          </div>
          <TripControls
            tripId={trip.id}
            tripName={trip.name}
            conditions={conds}
            renameAction={renameTripAction}
            cloneAction={cloneTripAction}
            deleteAction={deleteTripAction}
            editConditionsAction={updateTripConditionsAction}
            renameError={searchParams.renameError === "1"}
          />
        </div>
      </div>

      {/* Conditions summary — recessed readout well */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·A</span>
            Trip conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="data-mono text-xs leading-relaxed text-muted-foreground">{conditionsSummary(conds)}</p>
        </CardContent>
      </Card>

      {!result ? (
        <Card variant="well">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No recommendation result saved for this trip.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Gap analysis — the signature feature, visual centerpiece (raised plate) */}
          {result.gaps.length > 0 && (
            <Card variant="bezel" className="relative overflow-hidden">
              <span className="absolute inset-y-0 left-0 w-0.5 bg-destructive" aria-hidden />
              <CardHeader>
                <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
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
                      className="surface-well flex items-start gap-3 p-3"
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
            <Card variant="bezel" className="relative overflow-hidden">
              <span className="absolute inset-y-0 left-0 w-0.5 bg-blaze" aria-hidden />
              <CardHeader>
                <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
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
                        className="surface-well flex items-start gap-3 p-3"
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

          {/* Picks — recessed inventory well */}
          {result.picks.length > 0 ? (
            <Card variant="well">
              <CardHeader>
                <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
                  <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·B</span>
                  Picks — {result.picks.length} item{result.picks.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  These items from your closet satisfy at least one required capability.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.picks.map((pick, idx) => (
                  <div
                    key={pick.id}
                    className="surface-bezel flex items-start gap-3 p-3"
                  >
                    <span className="hud-readout mt-0.5 shrink-0 text-[0.5625rem] leading-none text-hud/70">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
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
            <Card variant="well">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No items from your inventory satisfy any required capability for this trip.{" "}
                <Link href="/" className="text-blaze underline-offset-2 hover:underline">
                  View your closet
                </Link>.
              </CardContent>
            </Card>
          )}

          {/* Layering systems — capabilities NO single item covers, satisfied by items worn TOGETHER.
              Rendered distinctly from single-item picks: a stacked set, not three separate picks. */}
          {systemOutcomes.length > 0 && (
            <Card variant="well">
              <CardHeader>
                <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
                  <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·B+</span>
                  Layering systems — {systemOutcomes.length} combination
                  {systemOutcomes.length !== 1 ? "s" : ""}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  No single item covers these, but items from your closet handle them{" "}
                  <span className="font-medium text-foreground">together</span> as a worn layering system.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {systemOutcomes.map((o) =>
                  // A capability may surface more than one viable system; show each as its own stack.
                  o.satisfiedBySystem.map((sys, sysIdx) => (
                    <div
                      key={`${o.capability}-${sysIdx}`}
                      className="surface-bezel relative overflow-hidden p-3"
                    >
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-600/70" aria-hidden />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {CAPABILITY_LABELS[o.capability as CapabilityKey]}
                        </p>
                        <Badge variant="success" className="shrink-0">
                          {sys.items.length}-piece system
                        </Badge>
                      </div>
                      {/* The stacked members, read as one combined system (mono readout, + joined). */}
                      <div className="surface-well mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 p-2">
                        {sys.items.map((m, i) => (
                          <span key={m.id} className="flex items-center gap-1.5">
                            {i > 0 && (
                              <span className="data-mono text-[0.6875rem] text-muted-foreground" aria-hidden>
                                +
                              </span>
                            )}
                            <Link
                              href={`/items/${m.id}`}
                              className="data-mono text-[0.6875rem] uppercase tracking-wide text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                            >
                              {m.name}
                            </Link>
                          </span>
                        ))}
                        <span className="data-mono ml-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                          — handled together
                        </span>
                      </div>
                    </div>
                  )),
                )}
              </CardContent>
            </Card>
          )}

          {/* Full outcomes table — recessed audit well */}
          <Card variant="well">
            <CardHeader>
              <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
                <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·C</span>
                Full capability outcomes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-px bg-seam/40">
                {result.outcomes.map((o) => (
                  <div
                    key={o.capability}
                    className="flex items-start gap-3 bg-bezel p-2.5"
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
                      {/* System satisfier (only when no single item covers it): show the worn set, + joined. */}
                      {o.satisfiedBy.length === 0 &&
                        o.satisfiedBySystem.map((sys, i) => (
                          <p
                            key={i}
                            className="data-mono mt-0.5 text-[0.6875rem] text-emerald-700 dark:text-emerald-400"
                          >
                            System: {sys.items.map((m) => m.name).join(" + ")}
                          </p>
                        ))}
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
              className="hud-readout text-[0.625rem] tracking-[0.16em] underline-offset-2 transition-colors hover:text-blaze hover:underline"
            >
              Plan another trip
            </Link>
            <Link
              href="/"
              className="hud-readout text-[0.625rem] tracking-[0.16em] underline-offset-2 transition-colors hover:text-blaze hover:underline"
            >
              Back to closet
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
