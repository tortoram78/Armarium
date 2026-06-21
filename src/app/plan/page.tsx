import { planTripAction, planFromDescriptionAction } from "@/app/actions";
import { tripParserMode } from "@/server/app-service";
import { TRIP_PRESETS } from "@/core/trips";
import { PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Masthead — field-manual section header */}
      <div className="border-b border-border pb-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
          <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
            Planner&nbsp;/&nbsp;Conditions&nbsp;→&nbsp;Capabilities
          </span>
        </div>
        <h1 className="heading-display text-3xl tracking-legend text-foreground">Plan a trip</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Describe your trip in plain language, or set conditions manually — the recommender derives
          what your gear needs to do and checks your closet.
        </p>
      </div>

      {/* Preset quick-starts — legend toggles (blaze tick on active) */}
      <div>
        <div className="mb-2.5 flex items-center gap-2">
          <span className="data-mono text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
            Quick-start
          </span>
          <span className="h-px flex-1 bg-border" aria-hidden />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRIP_PRESETS.map((p) => {
            const active = preset?.slug === p.slug;
            return (
              <a
                key={p.slug}
                href={`/plan?preset=${p.slug}`}
                className={
                  active
                    ? "label-structural rounded-sm border border-blaze bg-blaze/10 px-2.5 py-1 text-[0.625rem] text-foreground transition-colors duration-150 ease-crisp"
                    : "label-structural rounded-sm border border-border px-2.5 py-1 text-[0.625rem] text-muted-foreground transition-colors duration-150 ease-crisp hover:border-foreground/40 hover:text-foreground"
                }
                aria-current={active ? "true" : undefined}
              >
                {p.name}
              </a>
            );
          })}
        </div>
        {preset && (
          <p className="data-mono mt-2.5 text-[0.6875rem] text-muted-foreground">{preset.description}</p>
        )}
      </div>

      {/* Path 1: Natural language description */}
      <Card>
        <CardHeader>
          <CardTitle className="label-structural text-xs text-foreground">Describe it</CardTitle>
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
            <Button type="submit">Plan from description</Button>
          </form>
        </CardContent>
      </Card>

      {/* Path 2: Structured conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="label-structural text-xs text-foreground">Set conditions manually</CardTitle>
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

            <Button type="submit">Plan trip</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
