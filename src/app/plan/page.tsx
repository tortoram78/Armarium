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
    // ADR-0027 Phase 2 trip-input extras (live-only; not part of TripConditions, so always blank-seeded).
    days: "",
    partySize: "",
  };

  return (
    <div className="mx-auto max-w-2xl space-y-12">
      {/* ── Masthead ── */}
      <header className="max-w-xl">
        <p className="eyebrow mb-3">Plan a trip</p>
        <h1 className="display-xl text-foreground">Plan a trip</h1>
        <p className="mt-4 text-[0.975rem] leading-relaxed text-muted-foreground">
          Describe your trip in plain language, or set the conditions yourself. The recommender derives
          what your gear needs to do, then checks it against your closet.
        </p>
      </header>

      {/* ── Preset quick-starts ── */}
      <div className="space-y-3">
        <p className="eyebrow">Quick-start</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {TRIP_PRESETS.map((p) => {
            const active = preset?.slug === p.slug;
            return (
              <a
                key={p.slug}
                href={`/plan?preset=${p.slug}`}
                className={
                  active
                    ? "rounded-md bg-primary px-3.5 py-1.5 text-[0.8125rem] font-medium text-primary-foreground transition-colors duration-200 ease-crisp"
                    : "rounded-md px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 ease-crisp hover:bg-secondary hover:text-foreground"
                }
                aria-current={active ? "true" : undefined}
              >
                {p.name}
              </a>
            );
          })}
        </div>
        {preset && (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{preset.description}</p>
        )}
      </div>

      {/* ── Path 1: Natural language description ── */}
      <section className="panel p-6 sm:p-7">
        <div className="mb-5">
          <h2 className="display-md text-foreground">Describe it</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Write what you&apos;re planning and the system will infer the structured conditions for you.
            {parserMode === "offline" && (
              <span className="text-accent">
                {" "}
                Heuristic parser active (no API key) — results are approximate.
              </span>
            )}
          </p>
        </div>
        <form action={planFromDescriptionAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="nl-name">Trip name (optional)</Label>
            <Input
              id="nl-name"
              name="name"
              placeholder="My alpine trip"
              defaultValue={preset?.name ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nl-description">Description</Label>
            <Textarea
              id="nl-description"
              name="description"
              rows={4}
              placeholder="e.g. A 3-day backpacking trip in the Cascades in September — cold nights, likely rain, high exertion…"
              defaultValue={preset?.description ?? ""}
            />
          </div>
          <div className="pt-1">
            <SubmitButton pendingText="Planning…">Plan from description</SubmitButton>
          </div>
        </form>
      </section>

      {/* ── Path 2: Structured conditions + weather autofill ──
          The form is a client widget so a forecast pull (location + dates → Open-Meteo) can pre-fill the
          fields; every field stays editable and the submit still posts to planTripAction. */}
      <section className="panel p-6 sm:p-7">
        <div className="mb-6">
          <h2 className="display-md text-foreground">Pick a trip type</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Choose a trip type, add days and party size, and optionally pull a forecast — that&apos;s enough
            to plan. Every parameter is still tunable under “Adjust details.”
            {isGuest && (
              <span className="text-accent"> Results won&apos;t be saved until you log in.</span>
            )}
          </p>
        </div>
        {/* A guest posts to the NO-SAVE preview action (renders the result behind a save wall); an
            authenticated user posts to the existing save-on-plan action. Both are server actions passed
            as the `planAction` prop — no event handler crosses the server→client boundary (RSC-safe). */}
        <WeatherAutofill
          planAction={isGuest ? planPreviewAction : planTripAction}
          weatherAction={getWeatherConditionsAction}
          initial={initialConditions}
          initialName={preset?.name ?? ""}
        />
      </section>
    </div>
  );
}
