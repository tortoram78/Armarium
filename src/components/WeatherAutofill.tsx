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
  // ── ADR-0027 Phase 2 trip-input extras ──
  // `days` / `partySize` are LIVE-ONLY (no schema/persistence change): the actions thread them into the
  // engine's PackingOpts for the immediate plan, while the durable carriers are `activities` + `duration`
  // (which ride the conditions through the save/redirect). Strings because they are form values.
  days: string;
  partySize: string;
}

// Trip-type quick-select (ADR-0027 Phase 2). Each chip drops a SENSIBLE default `activities` + `duration`
// into the structured form — exactly the two fields the engine keys its urban/backcountry + overnight logic
// off. They are starting points: every field below stays editable. NOT hardcoded recommendations — they
// seed the SAME structured TripConditions any described/manual trip flows through.
interface TripType {
  id: string;
  label: string;
  activities: string;
  duration: TripConditions["duration"];
}
const TRIP_TYPES: readonly TripType[] = [
  { id: "day-hike", label: "Day hike", activities: "hiking", duration: "day" },
  { id: "backpacking", label: "Backpacking", activities: "backpacking, hiking", duration: "multiday" },
  { id: "alpine", label: "Alpine", activities: "alpine, hiking", duration: "day" },
  { id: "travel", label: "Travel", activities: "travel, city", duration: "day" },
  { id: "paddling", label: "Paddling", activities: "paddling", duration: "day" },
  { id: "camping", label: "Camping", activities: "camping", duration: "overnight" },
];

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
  const [tripType, setTripType] = useState<string | null>(null);
  // Per the v1 audit: LEAD with the friendly trip-type + forecast path; tuck the dense parameter grid behind
  // an "Adjust details" disclosure so the common case isn't a wall of selects. Opens automatically once a
  // forecast or trip-type touches the fields (so the user sees what changed).
  const [showDetails, setShowDetails] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Apply a trip-type chip: seed activities + duration (the two fields the engine keys its
  // urban/backcountry + overnight logic off). Toggling the active chip off clears the selection but leaves
  // the fields as-is (the user may have edited them since). Every field stays editable below.
  function applyTripType(t: TripType) {
    if (tripType === t.id) {
      setTripType(null);
      return;
    }
    setTripType(t.id);
    setForm((f) => ({ ...f, activities: t.activities, duration: t.duration }));
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
        setShowDetails(true); // reveal the grid so the user sees what the forecast filled
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

      {/* ── Trip type — the FRIENDLY lead (ADR-0027 Phase 2). One tap seeds activities + duration; ── */}
      <div className="space-y-2.5">
        <Label>Trip type</Label>
        <div className="flex flex-wrap gap-1.5">
          {TRIP_TYPES.map((t) => {
            const active = tripType === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTripType(t)}
                aria-pressed={active}
                className={
                  active
                    ? "rounded-md bg-primary px-3.5 py-1.5 text-[0.8125rem] font-medium text-primary-foreground transition-colors duration-200 ease-crisp"
                    : "rounded-md border border-border px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground transition-colors duration-200 ease-crisp hover:bg-secondary hover:text-foreground"
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          A starting point — sets the activities and trip length. Refine everything under “Adjust details.”
        </p>
      </div>

      {/* ── Days & party size — optional live-only sizing (ADR-0027 Phase 2). They scale the engine's ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="days">Days (optional)</Label>
          <Input
            id="days"
            name="days"
            type="number"
            min={1}
            placeholder="e.g. 3"
            value={form.days}
            onChange={(e) => set("days", e.target.value)}
            className="data-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="partySize">Party size (optional)</Label>
          <Input
            id="partySize"
            name="partySize"
            type="number"
            min={1}
            placeholder="e.g. 2"
            value={form.partySize}
            onChange={(e) => set("partySize", e.target.value)}
            className="data-mono"
          />
        </div>
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

      {/* ── Adjust details — the dense parameter grid, DE-EMPHASIZED behind a disclosure (v1 audit). All
          fields stay live form inputs even when collapsed (they post regardless), so the structured form
          is never broken — the disclosure only controls visibility. ── */}
      <div className="border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="subhead text-[0.95rem] text-foreground">Adjust details</span>
          <span className="text-sm text-muted-foreground">
            {showDetails ? "Hide −" : "Temperature, precipitation, wind, sun, exertion… +"}
          </span>
        </button>
      </div>

      {/* Kept mounted (hidden, not unmounted) so every field still posts when the form submits collapsed. */}
      <div className={showDetails ? "space-y-7" : "hidden"}>
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
      </div>
      {/* /Adjust details */}

      <div className="pt-1">
        <SubmitButton pendingText="Planning…">Plan trip</SubmitButton>
      </div>
    </form>
  );
}
