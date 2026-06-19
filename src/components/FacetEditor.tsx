"use client";

// Inline facet editor — lets the user correct universal soft facets and multi-label facets.
// Used on both the review page (draft) and the item detail page (confirmed item).
// "use client" because it uses interactive form controls with checkbox state; the form action
// is a server action and is passed as a prop.

import { useRef, useState } from "react";
import type { ItemClassification } from "@/core/classification";
import type { Evidence } from "@/core/evidence";
import {
  WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, MOISTURE_MANAGEMENT, DRY_SPEED,
  WARMTH_WHEN_WET, WARMTH, PACKABILITY, TECH_LIFESTYLE,
  LAYERING_ROLE, FUNCTION_PURPOSE, BODY_ZONE, ACTIVITY_FIT, CONDITIONS_FIT,
} from "@/core/facets/levels";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Map of universal facet key -> human label + allowed vocab
const SOFT_FACET_DEFS = [
  { key: "waterproofness", label: "Waterproofness", vocab: WATERPROOFNESS },
  { key: "wind_resistance", label: "Wind resistance", vocab: WIND_RESISTANCE },
  { key: "breathability", label: "Breathability", vocab: BREATHABILITY },
  { key: "moisture_management", label: "Moisture management", vocab: MOISTURE_MANAGEMENT },
  { key: "dry_speed", label: "Dry speed", vocab: DRY_SPEED },
  { key: "warmth_when_wet", label: "Warmth when wet", vocab: WARMTH_WHEN_WET },
  { key: "warmth", label: "Warmth", vocab: WARMTH },
  { key: "packability", label: "Packability", vocab: PACKABILITY },
  { key: "technical_vs_lifestyle", label: "Technical vs lifestyle", vocab: TECH_LIFESTYLE },
] as const;

const MULTI_FACET_DEFS = [
  { key: "layering_role", label: "Layering role", vocab: LAYERING_ROLE },
  { key: "function_purpose", label: "Function / purpose", vocab: FUNCTION_PURPOSE },
  { key: "body_zone_covered", label: "Body zone", vocab: BODY_ZONE },
  { key: "activity_fit", label: "Activity fit", vocab: ACTIVITY_FIT },
  { key: "conditions_fit", label: "Conditions fit", vocab: CONDITIONS_FIT },
] as const;

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function softValue(e: Evidence<string> | undefined | null): string {
  if (!e || e.value === null) return "unknown";
  return e.value;
}

interface FacetEditorProps {
  itemId: string;
  classification: ItemClassification;
  action: string | ((formData: FormData) => void | Promise<void>);
}

export function FacetEditor({ itemId, classification, action }: FacetEditorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm text-neutral-600 underline hover:text-neutral-900"
        >
          Correct facets
        </button>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-900">Edit facets</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-amber-700 underline"
            >
              Cancel
            </button>
          </div>
          <form action={action} className="space-y-5">
            <input type="hidden" name="id" value={itemId} />

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Universal soft facets
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SOFT_FACET_DEFS.map(({ key, label, vocab }) => {
                  // Access universal facet dynamically
                  const current = softValue(
                    (classification.universal as unknown as Record<string, Evidence<string> | null>)[key],
                  );
                  return (
                    <div key={key} className="space-y-0.5">
                      <Label className="text-xs">{label}</Label>
                      <Select name={key} defaultValue={current} className="text-xs h-8">
                        <option value="unknown">Unknown</option>
                        {vocab.map((v) => (
                          <option key={v} value={v}>{titleize(v)}</option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Multi-label facets
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {MULTI_FACET_DEFS.map(({ key, label, vocab }) => {
                  const current = (
                    classification.multilabel as Record<string, readonly string[]>
                  )[key] ?? [];
                  return (
                    <div key={key}>
                      <p className="mb-1 text-xs font-medium text-neutral-700">{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {vocab.map((v) => (
                          <label key={v} className="flex cursor-pointer items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              name={key}
                              value={v}
                              defaultChecked={(current as string[]).includes(v)}
                              className="h-3 w-3"
                            />
                            {titleize(v)}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm">Save corrections</Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
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
