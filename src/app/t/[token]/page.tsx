// Public, read-only shared trip (ADR-0033) — the "ship AND share" surface. Reached by an unguessable
// token (`/t/<token>`); no auth. We resolve the trip + recompute its packing checklist over the OWNER's
// closet (read-only — never a browsable closet or the owner's other trips), render the SAME PackingPlanView
// the dossier uses, and invite the viewer to plan their own. A bad/expired token → 404.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getSharedTrip } from "@/server/app-service";
import { conditionsSummary } from "@/components/TripResultView";
import { PackingPlanView } from "@/components/PackingPlanView";

export const dynamic = "force-dynamic";

export default async function SharedTripPage({ params }: { params: { token: string } }) {
  const shared = await getSharedTrip(params.token);
  if (!shared) notFound();
  const { name, conditions, plan } = shared;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Masthead */}
      <header className="space-y-4">
        <p className="eyebrow text-accent">Shared packing list</p>
        <h1 className="display-xl text-foreground">{name}</h1>
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.975rem] text-muted-foreground">
          <span className="text-primary">
            <span className="data-mono">{plan.summary.owned}</span> in their closet
          </span>
          <span aria-hidden className="text-muted-foreground/40">·</span>
          <span>
            <span className="data-mono text-foreground">{plan.summary.gap}</span> to bring
          </span>
        </p>
      </header>

      {/* Conditions */}
      <section className="panel bg-muted/40 p-5 sm:p-6">
        <p className="eyebrow mb-2.5">Trip conditions</p>
        <p className="text-[0.95rem] leading-relaxed text-foreground">{conditionsSummary(conditions)}</p>
      </section>

      {/* The checklist — readonly (no item deep-links for a public viewer). */}
      <PackingPlanView plan={plan} readonly />

      {/* CTA — turn a viewer into a user. */}
      <section className="panel elev-soft flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-l-2 border-l-accent p-6">
        <div className="min-w-0">
          <h2 className="display-md text-foreground">Make your own packing list</h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
            Armarium reasons over <span className="font-medium text-foreground">your</span> gear to tell you
            what to pack for any trip.
          </p>
        </div>
        <Link
          href="/signup"
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
        >
          Plan your own trip
        </Link>
      </section>
    </div>
  );
}
