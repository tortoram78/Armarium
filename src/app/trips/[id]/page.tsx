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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TripControls } from "@/components/TripControls";
import { TripResultView, conditionsSummary } from "@/components/TripResultView";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
          <TripResultView result={result} />

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
