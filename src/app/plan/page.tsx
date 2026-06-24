import { planTripAction, planPreviewAction, planFromDescriptionAction, getWeatherConditionsAction } from "@/app/actions";
import { tripParserMode } from "@/server/app-service";
import { TRIP_PRESETS } from "@/core/trips";
import { defaultConditions } from "@/core/conditions";
import { getUserIdOrGuest } from "@/lib/auth";
import { decodeConditions } from "@/lib/conditions-codec";
import { SubmitButton } from "@/components/SubmitButton";
import { WeatherAutofill } from "@/components/WeatherAutofill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// Merge a preset's conditions into the default values for the structured form.
function presetDefaults(searchParams: Record<string, string | undefined>) {
  const slug = searchParams.preset;
  if (!slug) return null;
  return TRIP_PRESETS.find((p) => p.slug === slug) ?? null;
}

export default async function PlanPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const preset = presetDefaults(searchParams);
  const parserMode = tripParserMode();

  // READ gate — never redirects. A guest gets the no-save preview action; an authed user keeps the
  // save-on-plan action. (Auth unconfigured/dev → isGuest:false → the unchanged save path.)
  const { isGuest } = await getUserIdOrGuest();

  // Conditions-as-prefill bridge: returning from the save-wall via /login?next=/plan?conditions=… (or the
  // preview's "edit" link) carries a validated conditions blob that pre-fills the structured form. The
  // codec Zod-validates the (untrusted) query value; a malformed one is ignored → preset/defaults stand.
  const prefill = decodeConditions(searchParams.conditions);

  // Seed the (now controlled) structured-conditions form: a valid conditions-prefill wins over a preset,
  // which wins over the blank defaults. The WeatherAutofill widget owns this as React state so a forecast
  // pull can prefill it; every field stays editable. String-typed because they are form values.
  const seed = prefill ?? preset?.conditions ?? defaultConditions();
  const initialConditions = {
    temp_min_c: seed.temp_min_c !== null ? String(seed.temp_min_c) : "",
    temp_max_c: seed.temp_max_c !== null ? String(seed.temp_max_c) : "",
    precipitation: seed.precipitation,
    wind: seed.wind,
    sun: seed.sun,
    exertion: seed.exertion,
    duration: seed.duration,
    exposure: seed.exposure,
    activities: seed.activities.join(", "),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Masthead — raised machined plate w/ ghosted stencil + HUD status rail */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* big ghosted stencil section number behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-2 -top-6 text-[7.5rem] sm:text-[9rem]"
          aria-hidden
        >
          03
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="hud-pip" aria-hidden />
            <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
              Planner&nbsp;·&nbsp;Conditions&nbsp;→&nbsp;Capabilities
            </span>
          </div>
          <h1 className="heading-display text-stamped text-4xl tracking-legend text-foreground sm:text-5xl">
            Plan a trip
          </h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Describe your trip in plain language, or set conditions manually — the recommender derives
            what your gear needs to do and checks your closet.
          </p>
        </div>

        {/* ── HUD status rail (recessed strip, real readouts) ── */}
        <div className="surface-well relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            PRESETS&nbsp;<span className="text-foreground/85">{String(TRIP_PRESETS.length).padStart(2, "0")}</span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            AXES&nbsp;<span className="text-foreground/85">08</span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            PARSER&nbsp;
            <span className={parserMode === "offline" ? "text-blaze" : "text-foreground/85"}>
              {parserMode === "offline" ? "HEURISTIC" : "LIVE"}
            </span>
          </span>
        </div>
      </div>

      {/* Preset quick-starts — machined toggle keys in a recessed track */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-readout mr-1 text-[0.625rem] tracking-[0.18em]">
          Quick-start
        </span>
        <div className="surface-well flex flex-wrap items-center gap-1 p-1">
          {TRIP_PRESETS.map((p) => {
            const active = preset?.slug === p.slug;
            return (
              <a
                key={p.slug}
                href={`/plan?preset=${p.slug}`}
                className={
                  active
                    ? "label-structural surface-rail text-stamped relative px-2.5 py-1 text-[0.625rem] text-foreground [background-color:hsl(var(--bezel))] transition-[color,box-shadow] duration-150 ease-crisp"
                    : "label-structural relative px-2.5 py-1 text-[0.625rem] text-muted-foreground transition-[color,box-shadow] duration-150 ease-crisp hover:text-foreground"
                }
                aria-current={active ? "true" : undefined}
              >
                {active && <span className="hud-pip absolute left-1 top-1" aria-hidden />}
                {p.name}
              </a>
            );
          })}
        </div>
      </div>
      {preset && (
        <p className="data-mono -mt-3 text-[0.6875rem] text-muted-foreground">{preset.description}</p>
      )}

      {/* Path 1: Natural language description — raised action plate */}
      <Card variant="bezel">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·A</span>
            Describe it
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Write what you&apos;re planning and the system will infer structured conditions.
            {parserMode === "offline" && (
              <span className="data-mono ml-1 uppercase tracking-wide text-blaze">
                Heuristic parser active (no API key) — results are approximate.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <form action={planFromDescriptionAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nl-name">Trip name (optional)</Label>
              <Input
                id="nl-name"
                name="name"
                placeholder="My alpine trip"
                defaultValue={preset?.name ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-description">Description</Label>
              <Textarea
                id="nl-description"
                name="description"
                rows={4}
                placeholder="e.g. A 3-day backpacking trip in the Cascades in September — cold nights, likely rain, high exertion…"
                defaultValue={preset?.description ?? ""}
              />
            </div>
            <SubmitButton pendingText="Planning…">Plan from description</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {/* Path 2: Structured conditions + weather autofill — recessed configuration well. The form is a
          client widget so a forecast pull (location + dates → Open-Meteo) can pre-fill the fields;
          every field stays editable and the submit still posts to planTripAction. */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·B</span>
            Set conditions manually
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pull a forecast from a location &amp; dates, or configure each parameter directly — either way
            you can adjust everything before planning.
            {isGuest && (
              <span className="data-mono ml-1 uppercase tracking-wide text-blaze">
                Results won&apos;t be saved until you log in.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          {/* A guest posts to the NO-SAVE preview action (renders the result behind a save wall); an
              authenticated user posts to the existing save-on-plan action. Both are server actions passed
              as the `planAction` prop — no event handler crosses the server→client boundary (RSC-safe). */}
          <WeatherAutofill
            planAction={isGuest ? planPreviewAction : planTripAction}
            weatherAction={getWeatherConditionsAction}
            initial={initialConditions}
            initialName={preset?.name ?? ""}
          />
        </CardContent>
      </Card>
    </div>
  );
}
