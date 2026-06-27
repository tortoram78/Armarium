// Guest / preview RESULT surface — the demo funnel's payoff screen.
//
// A no-save plan: `planPreviewAction` redirected here with the conditions encoded in the URL. We DECODE +
// Zod-VALIDATE that (untrusted) query value, re-run `planPreview` (NO save, no DB write) over the resolved
// closet for the current identity (a guest's seeded SAMPLE closet via getUserIdOrGuest → getRepositoryFor),
// and render the SAME recommendation / gap / verify / picks UI the saved-trip dossier uses (TripResultView).
//
// The save control is the WALL: "Log in to save this trip" → /login?next=/plan?conditions=… so a returning
// user lands on a pre-filled planner (conditions-as-prefill; NOT an auto-save — that bridge is deferred per
// ADR-0016). This page never writes; every real write stays behind requireUserId() in the actions.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserIdOrGuest } from "@/lib/auth";
import { planPackingFor } from "@/server/app-service";
import { decodeConditions, encodeConditions } from "@/lib/conditions-codec";
import { conditionsSummary } from "@/components/TripResultView";
import { PackingPlanView } from "@/components/PackingPlanView";
import { GuestBanner } from "@/components/GuestBanner";

export const dynamic = "force-dynamic";

export default async function PlanPreviewPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  // READ gate — never redirects. A guest is served the seeded SAMPLE closet; an authed user previewing
  // gets their own closet. Either way `planPreview` does NOT persist.
  const { userId, isGuest } = await getUserIdOrGuest();

  // The query string is UNTRUSTED — decodeConditions Zod-validates against the bounded conditions schema
  // and returns null on anything malformed. A bad/absent value bounces back to the planner (no crash).
  const conditions = decodeConditions(searchParams.conditions);
  if (!conditions) {
    redirect("/plan");
  }

  const name = String(searchParams.name ?? "").trim() || "Trip preview";

  // Run the REAL engine (ADR-0027) over the resolved closet — a full packing checklist, persistence dropped.
  const plan = await planPackingFor(name, conditions, userId);

  const ownedCount = plan.summary.owned;
  const gapCount = plan.summary.gap;
  const verifyCount = plan.summary.verify;

  // The conditions ride along to /login so a returning user lands on a pre-filled /plan form.
  const encoded = encodeConditions(conditions);
  const loginNext = `/plan?conditions=${encoded}`;
  const loginHref = `/login?next=${encodeURIComponent(loginNext)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Breadcrumb */}
      <Link
        href="/plan"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Planner / Preview
      </Link>

      {isGuest && (
        <GuestBanner
          next={loginNext}
          message="This is a preview against the sample closet — log in to save it and plan against your own gear."
        />
      )}

      {/* ── Header — the preview masthead, mirroring the saved-trip dossier ── */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow mb-3 text-accent">Preview · not saved</p>
          <h1 className="display-xl text-foreground">{name}</h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.975rem] text-muted-foreground">
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
        </div>

        {/* The SAVE WALL — saving requires an account. Carries the conditions to /login for prefill. */}
        <Link
          href={loginHref}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92 active:translate-y-px"
        >
          Log in to save this trip
        </Link>
      </header>

      {/* ── Conditions summary ── */}
      <section className="panel bg-muted/40 p-5 sm:p-6">
        <p className="eyebrow mb-2.5">Trip conditions</p>
        <p className="text-[0.95rem] leading-relaxed text-foreground">{conditionsSummary(conditions)}</p>
      </section>

      {/* The packing checklist body — readonly (item deep-links would bounce a guest to /login). */}
      <PackingPlanView plan={plan} readonly={isGuest} />

      {/* Footer wall — repeat the save invitation after the result, plus a way back to edit conditions. */}
      <section className="panel elev-soft flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-l-2 border-l-accent p-6">
        <div className="min-w-0">
          <h2 className="display-md text-foreground">Like this plan?</h2>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
            Log in to save it and plan against your own closet.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Link
            href={loginNext}
            className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Edit conditions
          </Link>
          <Link
            href={loginHref}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92 active:translate-y-px"
          >
            Log in to save
          </Link>
        </div>
      </section>
    </div>
  );
}
