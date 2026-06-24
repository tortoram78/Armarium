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
import { planPreview } from "@/server/app-service";
import { decodeConditions, encodeConditions } from "@/lib/conditions-codec";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TripResultView, conditionsSummary } from "@/components/TripResultView";
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

  // Re-run the REAL engine over the resolved closet — same reasoning as a saved plan, persistence dropped.
  const result = await planPreview(name, conditions, undefined, userId);

  const picksCount = result.picks.length;
  const gapsCount = result.gaps.length;
  const verifyCount = result.uncertain.length;

  // The conditions ride along to /login so a returning user lands on a pre-filled /plan form.
  const encoded = encodeConditions(conditions);
  const loginNext = `/plan?conditions=${encoded}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <Link
        href="/plan"
        className="hud-readout inline-flex items-center gap-1.5 text-[0.625rem] tracking-[0.16em] transition-colors hover:text-blaze"
      >
        <span aria-hidden>&larr;</span> Planner&nbsp;/&nbsp;Preview
      </Link>

      {isGuest && (
        <GuestBanner
          next={loginNext}
          message="This is a preview against the sample closet — log in to save it and plan against your own gear."
        />
      )}

      {/* Header — raised dossier plate (mirrors the saved-trip header, marked PREVIEW) */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        <span
          className="hud-stencil pointer-events-none absolute -right-1 -top-5 text-[6rem] sm:text-[7rem]"
          aria-hidden
        >
          PRV
        </span>
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.2em] text-blaze">
                Preview&nbsp;·&nbsp;Not&nbsp;Saved
              </span>
            </div>
            <h1 className="heading-display text-stamped text-3xl tracking-legend text-foreground sm:text-4xl">
              {name}
            </h1>
            <p className="hud-readout mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] tracking-[0.15em]">
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
          </div>

          {/* The SAVE WALL — saving requires an account. Carries the conditions to /login for prefill. */}
          <Link
            href={`/login?next=${encodeURIComponent(loginNext)}`}
            className="label-structural surface-bezel text-stamped shrink-0 px-4 py-2.5 text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))] transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985]"
          >
            Log in to save this trip
          </Link>
        </div>
      </div>

      {/* Conditions summary — recessed readout well (same as the saved-trip dossier) */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·A</span>
            Trip conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="data-mono text-xs leading-relaxed text-muted-foreground">
            {conditionsSummary(conditions)}
          </p>
        </CardContent>
      </Card>

      {/* The shared recommendation body — readonly (item deep-links would bounce a guest to /login). */}
      <TripResultView result={result} readonly={isGuest} />

      {/* Footer wall — repeat the save invitation after the result, plus a way back to edit conditions. */}
      <div className="surface-well flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="label-structural text-stamped text-xs text-foreground">Like this plan?</p>
          <p className="data-mono mt-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            Log in to save it and plan against your own closet.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={loginNext}
            className="hud-readout text-[0.625rem] tracking-[0.16em] underline-offset-2 transition-colors hover:text-blaze hover:underline"
          >
            Edit conditions
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(loginNext)}`}
            className="label-structural surface-bezel text-stamped px-4 py-2 text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))] transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985]"
          >
            Log in to save
          </Link>
        </div>
      </div>
    </div>
  );
}
