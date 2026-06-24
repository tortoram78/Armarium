import { planTripAction, planFromDescriptionAction } from "@/app/actions";
import { tripParserMode } from "@/server/app-service";
import { TRIP_PRESETS } from "@/core/trips";
import { PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import { SubmitButton } from "@/components/SubmitButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Merge a preset's conditions into the default values for the structured form.
function presetDefaults(searchParams: Record<string, string | undefined>) {
  const slug = searchParams.preset;
  if (!slug) return null;
  return TRIP_PRESETS.find((p) => p.slug === slug) ?? null;
}

export default async function PlanPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const preset = presetDefaults(searchParams);
  const parserMode = tripParserMode();

  const conds = preset?.conditions;

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

      {/* Path 2: Structured conditions — recessed configuration well */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·B</span>
            Set conditions manually
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Configure each parameter directly for precise control.
          </p>
        </CardHeader>
        <CardContent>
          <form action={planTripAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="struct-name">Trip name</Label>
              <Input
                id="struct-name"
                name="name"
                placeholder="Untitled trip"
                defaultValue={preset?.name ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="temp_min_c">Temp min (°C)</Label>
                <Input
                  id="temp_min_c"
                  name="temp_min_c"
                  type="number"
                  placeholder="e.g. 3"
                  defaultValue={conds?.temp_min_c ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="temp_max_c">Temp max (°C)</Label>
                <Input
                  id="temp_max_c"
                  name="temp_max_c"
                  type="number"
                  placeholder="e.g. 18"
                  defaultValue={conds?.temp_max_c ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Precipitation</Label>
                <Select name="precipitation" defaultValue={conds?.precipitation ?? "none"}>
                  {PRECIPITATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Wind</Label>
                <Select name="wind" defaultValue={conds?.wind ?? "calm"}>
                  {WIND.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sun</Label>
                <Select name="sun" defaultValue={conds?.sun ?? "moderate"}>
                  {SUN.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Exertion</Label>
                <Select name="exertion" defaultValue={conds?.exertion ?? "moderate"}>
                  {EXERTION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select name="duration" defaultValue={conds?.duration ?? "day"}>
                  {DURATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Exposure</Label>
                <Select name="exposure" defaultValue={conds?.exposure ?? "sheltered"}>
                  {EXPOSURE.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="activities">Activities (comma-separated)</Label>
              <Input
                id="activities"
                name="activities"
                placeholder="hiking, backpacking, alpine"
                defaultValue={conds?.activities.join(", ") ?? ""}
              />
            </div>

            <SubmitButton pendingText="Planning…">Plan trip</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
