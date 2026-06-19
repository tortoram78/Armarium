import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ItemClassificationSchema } from "@/core/classification";
import { FACET_KEYS, capabilityGateFacets } from "@/core/facets/registry";

// Cross-reference check (Operating Kit §04): the seam between the facet registry and the LLM output
// contract is checked by neither alone. A capability could gate on a facet the classifier can't produce,
// or the registry could drift from the schema. This asserts both directions resolve.

function classificationFieldNames(): Set<string> {
  const keys = new Set<string>();
  const shape = ItemClassificationSchema.shape;
  const add = (obj: z.ZodObject<z.ZodRawShape>) => {
    for (const k of Object.keys(obj.shape)) keys.add(k);
  };
  add(shape.identity);
  add(shape.universal);
  add(shape.multilabel);
  for (const g of Object.values(shape.groups.shape)) {
    const inner = g instanceof z.ZodOptional ? g.unwrap() : g;
    add(inner as z.ZodObject<z.ZodRawShape>);
  }
  return keys;
}

describe("cross-reference: facet registry <-> classification contract", () => {
  const fields = classificationFieldNames();

  it("every capability-gating facet is producible by the classifier (no gate reads a phantom facet)", () => {
    for (const k of capabilityGateFacets) expect(fields.has(k)).toBe(true);
  });

  it("every registry facet maps to a classification field (full coverage)", () => {
    expect(FACET_KEYS.filter((k) => !fields.has(k))).toEqual([]);
  });
});
