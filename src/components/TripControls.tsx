"use client";

// Trip dossier header controls — rename / clone / delete / edit-conditions, as refined editorial buttons.
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
      {/* Action rail — refined editorial buttons: rename / edit / clone / delete. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={panel === "rename" ? "subtle" : "ghost"}
          size="sm"
          onClick={() => setPanel((p) => (p === "rename" ? "none" : "rename"))}
          aria-expanded={panel === "rename"}
        >
          Rename
        </Button>
        <Button
          type="button"
          variant={panel === "conditions" ? "subtle" : "ghost"}
          size="sm"
          onClick={() => setPanel((p) => (p === "conditions" ? "none" : "conditions"))}
          aria-expanded={panel === "conditions"}
        >
          Edit conditions
        </Button>

        <span className="mx-1 h-5 w-px bg-border" aria-hidden />

        <form action={cloneAction} className="contents">
          <input type="hidden" name="id" value={tripId} />
          <SubmitButton pendingText="Cloning…">Clone</SubmitButton>
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

      {/* Rename panel — a quiet inline editorial sub-section. */}
      {panel === "rename" && (
        <div className="panel mt-4 bg-muted/40 p-5">
          <form action={renameAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={tripId} />
            <div className="flex-1 space-y-2" style={{ minWidth: "12rem" }}>
              <Label htmlFor="trip-rename">Trip name</Label>
              <Input
                id="trip-rename"
                name="name"
                defaultValue={tripName}
                maxLength={120}
                required
                autoFocus
              />
            </div>
            <SubmitButton pendingText="Saving…">Save name</SubmitButton>
          </form>
          {renameError && (
            <p className="mt-3 text-sm text-destructive">A trip name is required.</p>
          )}
        </div>
      )}

      {/* Edit-conditions panel — reuses the structured-conditions fields. Saving clears the stale
          result; the dossier then shows the Re-plan affordance (the trip is unplanned until re-planned). */}
      {panel === "conditions" && (
        <div className="panel mt-4 bg-muted/40 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-3">
            <h3 className="subhead text-[0.95rem] text-foreground">Edit conditions</h3>
            <span className="text-sm text-accent">Saving clears the result — re-plan after.</span>
          </div>
          <form action={editConditionsAction} className="space-y-5">
            <input type="hidden" name="id" value={tripId} />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-temp_min_c">Temp min (°C)</Label>
                <Input
                  id="edit-temp_min_c"
                  name="temp_min_c"
                  type="number"
                  placeholder="e.g. 3"
                  defaultValue={conditions.temp_min_c ?? ""}
                  className="data-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-temp_max_c">Temp max (°C)</Label>
                <Input
                  id="edit-temp_max_c"
                  name="temp_max_c"
                  type="number"
                  placeholder="e.g. 18"
                  defaultValue={conditions.temp_max_c ?? ""}
                  className="data-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Precipitation</Label>
                <Select name="precipitation" defaultValue={conditions.precipitation}>
                  {PRECIPITATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Wind</Label>
                <Select name="wind" defaultValue={conditions.wind}>
                  {WIND.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sun</Label>
                <Select name="sun" defaultValue={conditions.sun}>
                  {SUN.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Exertion</Label>
                <Select name="exertion" defaultValue={conditions.exertion}>
                  {EXERTION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select name="duration" defaultValue={conditions.duration}>
                  {DURATION.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Exposure</Label>
                <Select name="exposure" defaultValue={conditions.exposure}>
                  {EXPOSURE.map((v) => (
                    <option key={v} value={v}>{titleize(v)}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-activities">Activities (comma-separated)</Label>
              <Input
                id="edit-activities"
                name="activities"
                placeholder="hiking, backpacking, alpine"
                defaultValue={conditions.activities.join(", ")}
              />
            </div>

            <div className="flex gap-3 pt-1">
              <SubmitButton pendingText="Saving…">Save conditions</SubmitButton>
              <Button type="button" variant="outline" onClick={() => setPanel("none")}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
