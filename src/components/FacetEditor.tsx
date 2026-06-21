"use client";

// Inline facet editor — lets the user correct universal + group hard facts + multi-label facets.
// Driven entirely by the core registry (EDITABLE_UNIVERSAL, editableGroupFacets, EDITABLE_MULTILABEL).
// Form field `name` equals the facet `path` (e.g. "universal.warmth", "groups.insulation.fill_power").
// "use client" because it uses interactive form controls; the form action is a server action passed as
// a prop.

import { useState } from "react";
import type { ItemClassification } from "@/core/classification";
import {
  EDITABLE_UNIVERSAL,
  EDITABLE_MULTILABEL,
  editableGroupFacets,
  type EditableFacet,
} from "@/core/corrections";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read a scalar Evidence value from the classification at a dotted path. */
function readScalarValue(
  c: ItemClassification,
  path: string,
): string | number | null {
  const parts = path.split(".");
  if (parts[0] === "universal" && parts[1]) {
    const ev = (c.universal as unknown as Record<string, { value: unknown } | null>)[parts[1]];
    if (!ev || ev.value === null || ev.value === undefined) return null;
    return ev.value as string | number;
  }
  if (parts[0] === "groups" && parts[1] && parts[2]) {
    const grp = (c.groups as Record<string, Record<string, { value: unknown } | null> | undefined>)[parts[1]];
    if (!grp) return null;
    const ev = grp[parts[2]];
    if (!ev || ev.value === null || ev.value === undefined) return null;
    return ev.value as string | number;
  }
  return null;
}

/** Read a multi-label array from the classification at a dotted path. */
function readMultiValue(c: ItemClassification, path: string): string[] {
  const parts = path.split(".");
  if (parts[0] === "multilabel" && parts[1]) {
    const arr = (c.multilabel as unknown as Record<string, readonly string[]>)[parts[1]];
    return arr ? [...arr] : [];
  }
  return [];
}

/** Render a single editable scalar facet field. */
function ScalarField({ facet, value }: { facet: EditableFacet; value: string | number | null }) {
  const isNumeric = facet.tier === "hard_int" || facet.tier === "hard_num" || facet.tier === "soft_num";
  if (isNumeric) {
    return (
      <div className="space-y-1">
        <Label className="text-[0.625rem]">{facet.label}</Label>
        <input
          type="number"
          name={facet.path}
          defaultValue={value !== null ? String(value) : ""}
          step={facet.tier === "hard_int" ? "1" : "any"}
          placeholder="Unknown"
          className="h-8 w-full rounded-sm border border-input bg-background px-2 font-mono text-xs text-foreground shadow-press-in transition-[border-color] duration-150 ease-crisp placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    );
  }
  // enum (soft_enum / hard_enum)
  return (
    <div className="space-y-1">
      <Label className="text-[0.625rem]">{facet.label}</Label>
      <Select
        name={facet.path}
        defaultValue={value !== null ? String(value) : "unknown"}
        className="text-xs h-8"
      >
        <option value="unknown">Unknown</option>
        {(facet.vocab ?? []).map((v) => (
          <option key={v} value={v}>{titleize(v)}</option>
        ))}
      </Select>
    </div>
  );
}

interface FacetEditorProps {
  itemId: string;
  classification: ItemClassification;
  action: string | ((formData: FormData) => void | Promise<void>);
  /** If true, the editor opens immediately (for ?edit=1 deep-link). */
  defaultOpen?: boolean;
}

export function FacetEditor({ itemId, classification, action, defaultOpen }: FacetEditorProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  // Compute group sections dynamically from the core registry.
  const groupFacets = editableGroupFacets(classification);
  // Group them by their `group` key.
  const groupSections = new Map<string, EditableFacet[]>();
  for (const f of groupFacets) {
    if (!f.group) continue;
    const arr = groupSections.get(f.group) ?? [];
    arr.push(f);
    groupSections.set(f.group, arr);
  }

  return (
    <div className="mt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="label-structural rounded-sm border border-border px-2.5 py-1 text-[0.625rem] text-muted-foreground transition-colors duration-150 ease-crisp hover:border-blaze hover:text-blaze"
        >
          Correct facets
        </button>
      ) : (
        <div className="relative rounded-none border border-border bg-card p-4 shadow-letterpress">
          <span className="tick-accent" aria-hidden />
          <div className="mb-4 flex items-center justify-between border-b border-border pb-2">
            <h3 className="label-structural text-xs text-foreground">Edit facets</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="label-structural text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <form action={action} className="space-y-5">
            <input type="hidden" name="id" value={itemId} />

            {/* Universal section */}
            <section>
              <h4 className="label-structural mb-2 text-[0.625rem] text-muted-foreground">
                Universal
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {EDITABLE_UNIVERSAL.map((facet) => {
                  const value = readScalarValue(classification, facet.path);
                  return <ScalarField key={facet.path} facet={facet} value={value} />;
                })}
              </div>
            </section>

            {/* Group sections — only for groups this item carries */}
            {Array.from(groupSections.entries()).map(([groupKey, facets]) => (
              <section key={groupKey}>
                <h4 className="label-structural mb-2 text-[0.625rem] text-muted-foreground">
                  {titleize(groupKey)} specs
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {facets.map((facet) => {
                    const value = readScalarValue(classification, facet.path);
                    return <ScalarField key={facet.path} facet={facet} value={value} />;
                  })}
                </div>
              </section>
            ))}

            {/* Multi-label section */}
            <section>
              <h4 className="label-structural mb-2 text-[0.625rem] text-muted-foreground">
                Multi-label
              </h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {EDITABLE_MULTILABEL.map((facet) => {
                  const current = readMultiValue(classification, facet.path);
                  return (
                    <div key={facet.path}>
                      <p className="mb-1.5 text-xs font-medium text-foreground">{facet.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(facet.vocab ?? []).map((v) => (
                          <label key={v} className="flex cursor-pointer items-center gap-1.5 font-mono text-[0.6875rem] text-muted-foreground">
                            <input
                              type="checkbox"
                              name={facet.path}
                              value={v}
                              defaultChecked={current.includes(v)}
                              className="h-3 w-3 rounded-none accent-blaze"
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
