"use client";

// Trip dossier header controls — rename / clone / delete / edit-conditions, in the machined style.
// "use client" because the rename + edit-conditions panels toggle open (useState); the actual mutation
// is a SERVER ACTION passed in as a prop and bound to each <form action={…}>, so no event handler ever
// crosses the server→client boundary (the RSC-safe idiom used by FacetEditor). Clone is a SubmitButton
// (pending feedback); delete is a ConfirmButton (client confirm before the action runs).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { TripConditions } from "@/core/conditions";
import { PRECIPITATION, WIND, SUN, EXERTION, DURATION, EXPOSURE } from "@/core/conditions";

type ServerAction = (formData: FormData) => void | Promise<void>;

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TripControlsProps {
  tripId: string;
  tripName: string;
  conditions: TripConditions;
  renameAction: ServerAction;
  cloneAction: ServerAction;
  deleteAction: ServerAction;
  editConditionsAction: ServerAction;
  /** Surface the rename validation error (?renameError=1) by opening the panel pre-expanded. */
  renameError?: boolean;
}

export function TripControls({
  tripId,
  tripName,
  conditions,
  renameAction,
  cloneAction,
  deleteAction,
  editConditionsAction,
  renameError,
}: TripControlsProps) {
  const [panel, setPanel] = useState<"none" | "rename" | "conditions">(
    renameError ? "rename" : "none",
  );

  return (
    <div className="relative w-full">
      {/* Action rail — machined keys: rename / edit / clone / delete. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "rename" ? "none" : "rename"))}
          aria-expanded={panel === "rename"}
          className={
            panel === "rename"
              ? "label-structural surface-rail text-stamped px-2.5 py-1.5 text-[0.625rem] text-foreground transition-[filter] duration-150 ease-crisp hover:brightness-[1.06]"
              : "label-structural px-2.5 py-1.5 text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === "conditions" ? "none" : "conditions"))}
          aria-expanded={panel === "conditions"}
          className={
            panel === "conditions"
              ? "label-structural surface-rail text-stamped px-2.5 py-1.5 text-[0.625rem] text-foreground transition-[filter] duration-150 ease-crisp hover:brightness-[1.06]"
              : "label-structural px-2.5 py-1.5 text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          Edit conditions
        </button>

        <span className="mx-0.5 h-4 w-px bg-seam/50" aria-hidden />

        <form action={cloneAction} className="contents">
          <input type="hidden" name="id" value={tripId} />
          <SubmitButton pendingText="Cloning…" className="h-8 px-3 text-[0.6875rem]">
            Clone
          </SubmitButton>
        </form>

        <form action={deleteAction} className="contents">
          <input type="hidden" name="id" value={tripId} />
          <ConfirmButton
            message={`Delete "${tripName}"? This removes the trip and its recommendation.`}
            type="submit"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Delete
          </ConfirmButton>
        </form>
      </div>

      {/* Rename panel — recessed well, inline. */}
      {panel === "rename" && (
        <div className="surface-well mt-3 p-3">
          <form action={renameAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={tripId} />
            <div className="flex-1 space-y-1.5" style={{ minWidth: "12rem" }}>
              <Label htmlFor="trip-rename" className="text-[0.625rem]">
                Trip name
              </Label>
              <Input
                id="trip-rename"
                name="name"
                defaultValue={tripName}
                maxLength={120}
                required
                autoFocus
              />
            </div>
            <SubmitButton pendingText="Saving…" className="h-10">
              Save name
            </SubmitButton>
          </form>
          {renameError && (
            <p className="data-mono mt-2 text-[0.625rem] uppercase tracking-wide text-destructive">
              A trip name is required.
            </p>
          )}
        </div>
      )}

      {/* Edit-conditions panel — reuses the structured-conditions fields. Saving clears the stale
          result; the dossier then shows the Re-plan affordance (the trip is unplanned until re-planned). */}
      {panel === "conditions" && (
        <div className="surface-well mt-3 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-seam/40 pb-2">
            <h3 className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
              <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·E</span>
              Edit conditions
            </h3>
            <span className="data-mono text-[0.625rem] uppercase tracking-wide text-blaze">
              Saving clears the result — re-plan after
            </span>
          </div>
          <form action={editConditionsAction} className="space-y-4">
            <input type="hidden" name="id" value={tripId} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-temp_min_c">Temp min (°C)</Label>
                <Input
                  id="edit-temp_min_c"
                  name="temp_min_c"
                  type="number"
                  placeholder="e.g. 3"
                  defaultValue={conditions.temp_min_c ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-temp_max_c">Temp max (°C)</Label>
                <Input
                  id="edit-temp_max_c"
                  name="temp_max_c"
                  type="number"
                  placeholder="e.g. 18"
                  defaultValue={conditions.temp_max_c ?? ""}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Precipitation</Label>
                <Select name="precipitation" defaultValue={conditions.precipitation}>
                  {PRECIPITATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Wind</Label>
                <Select name="wind" defaultValue={conditions.wind}>
                  {WIND.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sun</Label>
                <Select name="sun" defaultValue={conditions.sun}>
                  {SUN.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Exertion</Label>
                <Select name="exertion" defaultValue={conditions.exertion}>
                  {EXERTION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select name="duration" defaultValue={conditions.duration}>
                  {DURATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Exposure</Label>
                <Select name="exposure" defaultValue={conditions.exposure}>
                  {EXPOSURE.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-activities">Activities (comma-separated)</Label>
              <Input
                id="edit-activities"
                name="activities"
                placeholder="hiking, backpacking, alpine"
                defaultValue={conditions.activities.join(", ")}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <SubmitButton pendingText="Saving…">Save conditions</SubmitButton>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10"
                onClick={() => setPanel("none")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
