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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plan a trip</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Describe your trip in plain language, or set conditions manually — the recommender derives
          what your gear needs to do and checks your closet.
        </p>
      </div>

      {/* Preset quick-starts */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
          Quick-start from a preset
        </p>
        <div className="flex flex-wrap gap-2">
          {TRIP_PRESETS.map((p) => (
            <a
              key={p.slug}
              href={`/plan?preset=${p.slug}`}
              className={
                preset?.slug === p.slug
                  ? "rounded-full border border-neutral-900 bg-neutral-900 px-3 py-1 text-xs text-white"
                  : "rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
              }
            >
              {p.name}
            </a>
          ))}
        </div>
        {preset && (
          <p className="mt-2 text-xs text-neutral-500 italic">{preset.description}</p>
        )}
      </div>

      {/* Path 1: Natural language description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Describe it</CardTitle>
          <p className="text-xs text-neutral-500">
            Write what you&apos;re planning and the system will infer structured conditions.
            {parserMode === "offline" && (
              <span className="ml-1 text-amber-700">
                Heuristic parser active (no API key) — results are approximate.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <form action={planFromDescriptionAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="nl-name">Trip name (optional)</Label>
              <Input
                id="nl-name"
                name="name"
                placeholder="My alpine trip"
                defaultValue={preset?.name ?? ""}
              />
            </div>
            <div className="space-y-1">
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
          <CardTitle className="text-base">Set conditions manually</CardTitle>
          <p className="text-xs text-neutral-500">
            Configure each parameter directly for precise control.
          </p>
        </CardHeader>
        <CardContent>
          <form action={planTripAction} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="struct-name">Trip name</Label>
              <Input
                id="struct-name"
                name="name"
                placeholder="Untitled trip"
                defaultValue={preset?.name ?? ""}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="temp_min_c">Temp min (°C)</Label>
                <Input
                  id="temp_min_c"
                  name="temp_min_c"
                  type="number"
                  placeholder="e.g. 3"
                  defaultValue={conds?.temp_min_c ?? ""}
                />
              </div>
              <div className="space-y-1">
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
              <div className="space-y-1">
                <Label>Precipitation</Label>
                <Select name="precipitation" defaultValue={conds?.precipitation ?? "none"}>
                  {PRECIPITATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Wind</Label>
                <Select name="wind" defaultValue={conds?.wind ?? "calm"}>
                  {WIND.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Sun</Label>
                <Select name="sun" defaultValue={conds?.sun ?? "moderate"}>
                  {SUN.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Exertion</Label>
                <Select name="exertion" defaultValue={conds?.exertion ?? "moderate"}>
                  {EXERTION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Duration</Label>
                <Select name="duration" defaultValue={conds?.duration ?? "day"}>
                  {DURATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Exposure</Label>
                <Select name="exposure" defaultValue={conds?.exposure ?? "sheltered"}>
                  {EXPOSURE.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1">
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
