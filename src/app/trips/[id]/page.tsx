import { notFound } from "next/navigation";
import Link from "next/link";
import { getTrip, planPackingFor } from "@/server/app-service";
import {
  replanTripAction,
  renameTripAction,
  cloneTripAction,
  deleteTripAction,
  updateTripConditionsAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { TripControls } from "@/components/TripControls";
import { conditionsSummary } from "@/components/TripResultView";
import { PackingPlanView } from "@/components/PackingPlanView";
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

  const conds = trip.conditions;
  // Compute the packing checklist LIVE from the trip's conditions + the CURRENT closet (ADR-0027) — so a
  // saved trip always reflects the gear you own now (no stale snapshot to re-plan).
  const plan = await planPackingFor(trip.name, conds, userId);

  const ownedCount = plan.summary.owned;
  const gapCount = plan.summary.gap;
  const verifyCount = plan.summary.verify;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Breadcrumb */}
      <Link
        href="/trips"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Trips
      </Link>

      {/* ── Header — the dossier masthead ── */}
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 max-w-2xl">
            <p className="eyebrow mb-3">Recommendation</p>
            <h1 className="display-xl text-foreground">{trip.name}</h1>
            <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.975rem] text-muted-foreground">
              <span>
                Planned{" "}
                <span className="data-mono text-foreground">
                  {new Date(trip.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground/40">·</span>
              <span className="text-primary">
                <span className="data-mono">{ownedCount}</span> in your closet
              </span>
              <span aria-hidden className="text-muted-foreground/40">·</span>
              <span>
                <span className="data-mono text-foreground">{gapCount}</span> to bring
              </span>
              {verifyCount > 0 && (
                <>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span className="text-accent">
                    <span className="data-mono">{verifyCount}</span> to verify
                  </span>
                </>
              )}
            </p>
            {trip.description && (
              <p className="mt-3 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
                {trip.description}
              </p>
            )}
          </div>

          <form action={replanTripAction} className="shrink-0">
            <input type="hidden" name="id" value={trip.id} />
            <Button type="submit" variant="outline" size="sm">
              Re-plan with current closet
            </Button>
          </form>
        </div>

        {/* Trip controls (rename / edit conditions / clone / delete) */}
        <div className="border-t border-border pt-5">
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
      </header>

      {/* ── Conditions summary ── */}
      <section className="panel bg-muted/40 p-5 sm:p-6">
        <p className="eyebrow mb-2.5">Trip conditions</p>
        <p className="text-[0.95rem] leading-relaxed text-foreground">{conditionsSummary(conds)}</p>
      </section>

      <PackingPlanView plan={plan} />

      {/* Links */}
      <div className="flex gap-6 border-t border-border pt-6 pb-4">
        <Link
          href="/plan"
          className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Plan another trip
        </Link>
        <Link
          href="/"
          className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Back to closet
        </Link>
      </div>
    </div>
  );
}
