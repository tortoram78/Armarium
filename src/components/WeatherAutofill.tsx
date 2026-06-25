"use client";

// Weather auto-conditions widget + the structured-conditions form (Phase 3 step 3, ADR-0015).
//
// Why this owns the whole structured form: the planner's conditions fields must be PRE-FILLABLE from a
// forecast, which means they have to be controlled (React state), not uncontrolled `defaultValue` inputs.
// So the "Where & when" forecast block and the conditions fields live together here, sharing one piece of
// state. The user enters a location + date window, hits "Pull conditions from forecast", and the derived
// temp band / precipitation / wind / duration drop into the fields — every one of which stays editable
// (override-always: the forecast is a starting point, never a lock).
//
// "use client" because of the interactive forecast button + controlled inputs. The PLAN action and the
// WEATHER action are both SERVER ACTIONS passed in as props (the RSC-safe idiom used by FacetEditor /
// TripControls): no event handler ever crosses the server→client boundary. The plan submit still posts
// straight to the existing `planTripAction`; we only fetch the forecast imperatively to prefill.
//
// Degrade-to-manual: a null/failed forecast (unknown location, beyond the ~16-day horizon, network error)
// returns `{ ok:false }` from the action → a quiet inline note, fields untouched, planning never blocked.

import { useState, useTransition } from "react";
import type { TripConditions } from "@/core/conditions";
import { PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";
import type { WeatherConditionsResult } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/SubmitButton";

type ServerAction = (formData: FormData) => void | Promise<void>;
type WeatherAction = (formData: FormData) => Promise<WeatherConditionsResult>;

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// The conditions fields the form drives, as strings (form values). Mirrors the structured form that the
// plan page used to render inline; seeded from a preset (or blank) and overwritten by a forecast pull.
interface FormState {
  temp_min_c: string;
  temp_max_c: string;
  precipitation: TripConditions["precipitation"];
  wind: TripConditions["wind"];
  sun: TripConditions["sun"];
  exertion: TripConditions["exertion"];
  duration: TripConditions["duration"];
  exposure: TripConditions["exposure"];
  activities: string;
}

interface WeatherAutofillProps {
  /** Existing planTripAction — the form posts here unchanged once conditions are set/edited. */
  planAction: ServerAction;
  /** getWeatherConditionsAction — fetched imperatively to prefill; returns data, never redirects. */
  weatherAction: WeatherAction;
  /** Seed values from a quick-start preset (or blank defaults). */
  initial: FormState;
  /** Preset/default trip name. */
  initialName: string;
}

// Map the derived TripConditions back onto the string-based form state. Only the weather-determinable
// facets are overwritten; sun / exertion / exposure / activities the forecast can't know are preserved.
function applyForecast(prev: FormState, c: TripConditions): FormState {
  return {
    ...prev,
    temp_min_c: c.temp_min_c !== null ? String(c.temp_min_c) : "",
    temp_max_c: c.temp_max_c !== null ? String(c.temp_max_c) : "",
    precipitation: c.precipitation,
    wind: c.wind,
    duration: c.duration,
  };
}

type Note =
  | { kind: "filled"; label: string }
  | { kind: "manual" }
  | null;

export function WeatherAutofill({ planAction, weatherAction, initial, initialName }: WeatherAutofillProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [where, setWhere] = useState({ location: "", startDate: "", endDate: "" });
  const [note, setNote] = useState<Note>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function pullForecast() {
    const fd = new FormData();
    fd.set("location", where.location);
    fd.set("startDate", where.startDate);
    fd.set("endDate", where.endDate);
    startTransition(async () => {
      const result = await weatherAction(fd);
      if (result.ok) {
        setForm((f) => applyForecast(f, result.conditions));
        setNote({ kind: "filled", label: result.locationLabel });
      } else {
        // First-class manual fallback: leave the conditions fields untouched, just say so.
        setNote({ kind: "manual" });
      }
    });
  }

  const canPull = where.location.trim() !== "" && where.startDate !== "" && where.endDate !== "" && !pending;

  return (
    <form action={planAction} className="space-y-7">
      <div className="space-y-2">
        <Label htmlFor="struct-name">Trip name</Label>
        <Input id="struct-name" name="name" placeholder="Untitled trip" defaultValue={initialName} />
      </div>

      {/* ── Where & when — the forecast block, a quiet recessed sub-section ── */}
      <div className="panel bg-muted/40 p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-3">
          <h3 className="subhead text-[0.95rem] text-foreground">Where &amp; when</h3>
          <span className="eyebrow">Forecast → conditions</span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wx-location">Location</Label>
          <Input
            id="wx-location"
            value={where.location}
            onChange={(e) => setWhere((w) => ({ ...w, location: e.target.value }))}
            placeholder="e.g. Chamonix, France"
            autoComplete="off"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="wx-start">Start date</Label>
            <Input
              id="wx-start"
              type="date"
              value={where.startDate}
              onChange={(e) => setWhere((w) => ({ ...w, startDate: e.target.value }))}
              className="data-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wx-end">End date</Label>
            <Input
              id="wx-end"
              type="date"
              value={where.endDate}
              min={where.startDate || undefined}
              onChange={(e) => setWhere((w) => ({ ...w, endDate: e.target.value }))}
              className="data-mono"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={pullForecast}
            disabled={!canPull}
            aria-busy={pending}
          >
            {pending ? "Pulling…" : "Pull conditions from forecast"}
          </Button>

          {note?.kind === "filled" && (
            <span className="text-sm text-accent">
              {note.label} — pulled from forecast. Edit anything below.
            </span>
          )}
          {note?.kind === "manual" && (
            <span className="text-sm text-muted-foreground">
              Couldn&apos;t fetch a forecast for that location and date — enter conditions below manually.
            </span>
          )}
        </div>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Optional. Pulls a real forecast (≈16-day horizon) to pre-fill temperature, precipitation, wind,
          and duration — a starting point you can override. Or just set everything by hand below.
        </p>
      </div>

      {/* ── Conditions — controlled, prefillable, always editable ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="temp_min_c">Temp min (°C)</Label>
          <Input
            id="temp_min_c"
            name="temp_min_c"
            type="number"
            placeholder="e.g. 3"
            value={form.temp_min_c}
            onChange={(e) => set("temp_min_c", e.target.value)}
            className="data-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="temp_max_c">Temp max (°C)</Label>
          <Input
            id="temp_max_c"
            name="temp_max_c"
            type="number"
            placeholder="e.g. 18"
            value={form.temp_max_c}
            onChange={(e) => set("temp_max_c", e.target.value)}
            className="data-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Precipitation</Label>
          <Select name="precipitation" value={form.precipitation} onChange={(e) => set("precipitation", e.target.value as FormState["precipitation"])}>
            {PRECIPITATION.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Wind</Label>
          <Select name="wind" value={form.wind} onChange={(e) => set("wind", e.target.value as FormState["wind"])}>
            {WIND.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Sun</Label>
          <Select name="sun" value={form.sun} onChange={(e) => set("sun", e.target.value as FormState["sun"])}>
            {SUN.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Exertion</Label>
          <Select name="exertion" value={form.exertion} onChange={(e) => set("exertion", e.target.value as FormState["exertion"])}>
            {EXERTION.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Duration</Label>
          <Select name="duration" value={form.duration} onChange={(e) => set("duration", e.target.value as FormState["duration"])}>
            {DURATION.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Exposure</Label>
          <Select name="exposure" value={form.exposure} onChange={(e) => set("exposure", e.target.value as FormState["exposure"])}>
            {EXPOSURE.map((v) => (
              <option key={v} value={v}>{titleize(v)}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="activities">Activities (comma-separated)</Label>
        <Input
          id="activities"
          name="activities"
          placeholder="hiking, backpacking, alpine"
          value={form.activities}
          onChange={(e) => set("activities", e.target.value)}
        />
      </div>

      <div className="pt-1">
        <SubmitButton pendingText="Planning…">Plan trip</SubmitButton>
      </div>
    </form>
  );
}
