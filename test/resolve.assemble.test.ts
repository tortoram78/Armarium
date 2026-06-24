// Unit tests for the CLAIM → CLASSIFICATION assembler + the classification → claims decomposer
// (Phase 3 — ADR-0014 §3/§5). These pin the PURE core of the claims pipeline with no DB and no LLM:
//   - a multi-source claim set resolves to the correct ItemClassification by precedence;
//   - an INFERRED hard fact has nowhere to live (demoted to null+unknown) — the load-bearing invariant;
//   - a multilabel value array is carried + validated against its closed enum;
//   - manufacturer + derived + inferred claims resolve together (manufacturer/derived out-rank inference);
//   - an unregistered (novel) facetKey is skipped by the assembler (it lives in the store, not the view);
//   - decompose → re-assemble round-trips the resolved facets (the offline evidence trail).

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  assembleClassification,
  decomposeToClaims,
  FACET_PATHS,
  MATERIALS_FACET_KEY,
  TREATMENTS_FACET_KEY,
} from "@/core/resolve";
import { ItemClassificationSchema, parseClassification, type ItemClassification } from "@/core/classification";
import type { EvidenceClaim } from "@/core/ports";

const claim = (over: Partial<EvidenceClaim> & Pick<EvidenceClaim, "facetKey" | "value">): EvidenceClaim => ({
  confidence: "medium",
  source: "inferred",
  evidence: "test",
  ...over,
});

// CROSS-REFERENCE GUARD: FACET_PATHS is a parallel table to the ItemClassification schema. If it drifts,
// a facet becomes un-resolvable from claims (silently). Assert it covers EXACTLY the scalar/multilabel
// leaf facets of the schema (materials/treatments/applicable_groups are whole-array/derived, excluded).
describe("FACET_PATHS <-> ItemClassification coverage (no drift)", () => {
  function schemaFacetKeys(): Set<string> {
    const keys = new Set<string>();
    const shape = ItemClassificationSchema.shape;
    const addObj = (prefix: string, obj: z.ZodObject<z.ZodRawShape>) => {
      for (const k of Object.keys(obj.shape)) keys.add(`${prefix}.${k}`);
    };
    addObj("identity", shape.identity);
    addObj("universal", shape.universal);
    addObj("multilabel", shape.multilabel);
    for (const [g, def] of Object.entries(shape.groups.shape)) {
      const inner = def instanceof z.ZodOptional ? def.unwrap() : def;
      addObj(`groups.${g}`, inner as z.ZodObject<z.ZodRawShape>);
    }
    return keys;
  }

  it("every scalar/multilabel classification facet has a FACET_PATHS entry, and vice-versa", () => {
    const schemaKeys = schemaFacetKeys();
    const pathKeys = new Set(FACET_PATHS.map((d) => d.key));
    // Every schema facet is addressable.
    expect([...schemaKeys].filter((k) => !pathKeys.has(k))).toEqual([]);
    // Every FACET_PATHS key is a real schema facet (no phantom path).
    expect([...pathKeys].filter((k) => !schemaKeys.has(k))).toEqual([]);
  });
});

describe("assembleClassification — claims resolve into the ItemClassification shape", () => {
  it("assembles a multi-facet inferred claim set into a valid classification", () => {
    const c = assembleClassification("Test Jacket", [
      claim({ facetKey: "universal.warmth", value: "high", confidence: "high" }),
      claim({ facetKey: "universal.waterproofness", value: "dwr", confidence: "medium" }),
      claim({ facetKey: "multilabel.layering_role", value: ["mid", "static_insulation"], confidence: "high" }),
    ]);

    expect(c.name).toBe("Test Jacket");
    expect(c.universal.warmth).toMatchObject({ value: "high", source: "inferred", confidence: "high" });
    expect(c.universal.waterproofness).toMatchObject({ value: "dwr", source: "inferred" });
    expect(c.multilabel.layering_role).toEqual(["mid", "static_insulation"]);
    // A facet with no claim stays the honest known-unknown (never fabricated).
    expect(c.universal.packability.value).toBeNull();
    // The assembled shape is a valid classification (round-trips parseClassification).
    expect(() => parseClassification(c)).not.toThrow();
  });

  it("resolves the WINNER per facet by precedence (derived beats inferred; user beats all)", () => {
    const c = assembleClassification("Cotton Tee", [
      // inferred says wicks; derived (physics) says absorbs_holds → derived wins (medium, not fill-only).
      claim({ facetKey: "universal.moisture_management", value: "wicks", source: "inferred", confidence: "high" }),
      claim({ facetKey: "universal.moisture_management", value: "absorbs_holds", source: "derived_from_material", confidence: "medium" }),
      // user correction on warmth beats an inferred guess.
      claim({ facetKey: "universal.warmth", value: "minimal", source: "inferred", confidence: "high" }),
      claim({ facetKey: "universal.warmth", value: "light", source: "user", confidence: "high" }),
    ]);

    expect(c.universal.moisture_management).toMatchObject({ value: "absorbs_holds", source: "derived_from_material" });
    expect(c.universal.warmth).toMatchObject({ value: "light", source: "user" });
    // The winner's evidence carries the auditable "won over" trail.
    expect(c.universal.moisture_management.evidence).toContain("won over");
  });

  it("DEMOTES an inferred hard fact at the assembly boundary (null+unknown — the invariant)", () => {
    // An inferred hard fact that somehow reached the assembler (e.g. a hand-built claim set) must NOT
    // survive: parseClassification's hardFact preprocessor demotes it. (The ingestion boundary also drops
    // it first; this is the defense-in-depth layer.)
    const c = assembleClassification("Sneaky Jacket", [
      claim({ facetKey: "universal.upf", value: 40, source: "inferred", confidence: "high" }),
      claim({ facetKey: "identity.brand", value: "GuessBrand", source: "inferred", confidence: "high" }),
      claim({ facetKey: "groups.insulation.fill_power", value: 800, source: "inferred", confidence: "high" }),
    ]);

    expect(c.universal.upf.value).toBeNull();
    expect(c.universal.upf.source).toBe("unknown");
    expect(c.identity.brand.value).toBeNull();
    // The insulation group has no surviving hard fact → it is dropped from applicable_groups.
    expect(c.applicable_groups).not.toContain("insulation");
  });

  it("a MANUFACTURER hard fact is authoritative — it survives where an inferred one would not", () => {
    const c = assembleClassification("Real Jacket", [
      claim({ facetKey: "universal.upf", value: 50, source: "manufacturer", confidence: "high", evidence: "stated UPF 50" }),
      claim({ facetKey: "identity.brand", value: "Patagonia", source: "manufacturer", confidence: "high", evidence: "brand" }),
    ]);
    expect(c.universal.upf).toMatchObject({ value: 50, source: "manufacturer" });
    expect(c.identity.brand).toMatchObject({ value: "Patagonia", source: "manufacturer" });
  });

  it("a multilabel array filters to the closed enum via parseClassification (invalid value rejected)", () => {
    // An out-of-vocab multilabel value must make the assembled blob fail validation (the hard boundary).
    expect(() =>
      assembleClassification("Bad Labels", [
        claim({ facetKey: "multilabel.activity_fit", value: ["hiking", "not_a_real_activity"], confidence: "high" }),
      ]),
    ).toThrow();

    // A clean array assembles and is preserved.
    const ok = assembleClassification("Good Labels", [
      claim({ facetKey: "multilabel.activity_fit", value: ["hiking", "alpine"], confidence: "high" }),
    ]);
    expect(ok.multilabel.activity_fit).toEqual(["hiking", "alpine"]);
  });

  it("groups are EMERGENT — a present group field puts the group in applicable_groups", () => {
    const c = assembleClassification("Down Puffy", [
      claim({ facetKey: "groups.insulation.fill_type", value: "down", source: "manufacturer", confidence: "high", evidence: "down fill stated" }),
      claim({ facetKey: "groups.insulation.warmth_for_weight", value: "high", source: "inferred", confidence: "medium" }),
    ]);
    expect(c.applicable_groups).toContain("insulation");
    expect(c.groups.insulation?.fill_type).toMatchObject({ value: "down", source: "manufacturer" });
    expect(c.groups.insulation?.warmth_for_weight).toMatchObject({ value: "high", source: "inferred" });
    // A group with NO present field is absent entirely.
    expect(c.applicable_groups).not.toContain("sleep");
    expect(c.groups.sleep).toBeUndefined();
  });

  it("an UNREGISTERED (novel) facetKey is skipped by the assembler (it lives in the store, not the view)", () => {
    const c = assembleClassification("Novel Item", [
      claim({ facetKey: "universal.warmth", value: "high", confidence: "high" }),
      claim({ facetKey: "novel.bioluminescence", value: "high", confidence: "high" }),
    ]);
    // The registry facet resolves; the novel key does not appear anywhere in the resolved shape.
    expect(c.universal.warmth.value).toBe("high");
    expect(JSON.stringify(c)).not.toContain("bioluminescence");
    expect(() => parseClassification(c)).not.toThrow();
  });

  it("resolves a MATERIALS composition claim (whole array, manufacturer wins over inferred)", () => {
    const inferredComp = [
      { role: "shell", name: null, fiber_components: [{ fiber: "nylon", pct: 100 }], construction_type: null, source: "inferred", evidence: "guess" },
    ];
    const mfrComp = [
      { role: "shell", name: "recycled polyester", fiber_components: [{ fiber: "polyester", pct: 100, recycled: true }], construction_type: "woven", source: "manufacturer", evidence: "stated" },
    ];
    const c = assembleClassification("Composed", [
      claim({ facetKey: MATERIALS_FACET_KEY, value: inferredComp, source: "inferred", confidence: "high" }),
      claim({ facetKey: MATERIALS_FACET_KEY, value: mfrComp, source: "manufacturer", confidence: "high", evidence: "stated" }),
    ]);
    expect(c.materials.length).toBe(1);
    expect(c.materials[0]!.source).toBe("manufacturer");
    expect(c.materials[0]!.fiber_components[0]!.fiber).toBe("polyester");
  });

  it("resolves a TREATMENTS claim (whole array, manufacturer DWR wins over an inferred treatment)", () => {
    // Symmetric with materials: a treatments list is one atomic stated set. A manufacturer DWR finish must
    // out-rank an inferred guess and survive into the resolved classification with its source intact.
    const inferredTreat = [
      { kind: "dwr", condition: "degraded", source: "inferred", evidence: "looks worn" },
    ];
    const mfrTreat = [
      { kind: "dwr", condition: "factory_fresh", source: "manufacturer", evidence: "DWR finish" },
    ];
    const c = assembleClassification("Treated Shell", [
      claim({ facetKey: TREATMENTS_FACET_KEY, value: inferredTreat, source: "inferred", confidence: "high" }),
      claim({ facetKey: TREATMENTS_FACET_KEY, value: mfrTreat, source: "manufacturer", confidence: "high", evidence: "stated" }),
    ]);
    expect(c.treatments.length).toBe(1);
    expect(c.treatments[0]!.source).toBe("manufacturer");
    expect(c.treatments[0]!.condition).toBe("factory_fresh");
    expect(c.treatments).toEqual(mfrTreat);
  });
});

describe("decomposeToClaims — a resolved classification → its claim trail (offline items, §5)", () => {
  // A manufacturer-stated DWR finish (exactly the shape a seed item like `terrePlaning` carries) — the
  // round-trip below proves decompose→assemble never silently erases it (the regression this test locks).
  const MFR_DWR = [{ kind: "dwr", condition: "factory_fresh", source: "manufacturer", evidence: "DWR finish" }] as const;

  function build(over: Partial<{ warmth: ItemClassification["universal"]["warmth"] }>): ItemClassification {
    return assembleClassification("Decompose Subject", [
      claim({ facetKey: "universal.warmth", value: "moderate", source: "inferred", confidence: "high" }),
      claim({ facetKey: "universal.upf", value: 50, source: "manufacturer", confidence: "high", evidence: "UPF 50 stated" }),
      claim({ facetKey: "multilabel.activity_fit", value: ["hiking"], confidence: "high" }),
      claim({ facetKey: TREATMENTS_FACET_KEY, value: MFR_DWR, source: "manufacturer", confidence: "high", evidence: "stated" }),
      ...(over.warmth ? [] : []),
    ]);
  }

  it("emits one claim per PRESENT facet, preserving each facet's own source", () => {
    const c = build({});
    const claims = decomposeToClaims(c, "offline-classifier-v1");

    const warmth = claims.find((x) => x.facetKey === "universal.warmth");
    expect(warmth).toMatchObject({ value: "moderate", source: "inferred", extractorVersion: "offline-classifier-v1" });

    // A hard fact survived (manufacturer) → decomposed at "high" with its manufacturer source preserved.
    const upf = claims.find((x) => x.facetKey === "universal.upf");
    expect(upf).toMatchObject({ value: 50, source: "manufacturer", confidence: "high" });

    const activity = claims.find((x) => x.facetKey === "multilabel.activity_fit");
    expect(activity?.value).toEqual(["hiking"]);

    // A manufacturer treatment decomposes to a single whole-array claim under TREATMENTS_FACET_KEY, with
    // its authoritative source preserved (not relabeled "inferred").
    const treatment = claims.find((x) => x.facetKey === TREATMENTS_FACET_KEY);
    expect(treatment).toMatchObject({ value: MFR_DWR, source: "manufacturer", confidence: "high" });

    // No claim is emitted for an unknown facet (the store holds asserting claims only).
    expect(claims.some((x) => x.facetKey === "universal.packability")).toBe(false);
  });

  it("decompose → re-assemble round-trips the resolved facets (treatments survive — no silent erasure)", () => {
    const original = build({});
    // Sanity: the fixture genuinely carries the manufacturer DWR going in (else the round-trip is vacuous).
    expect(original.treatments).toEqual(MFR_DWR);

    const reassembled = assembleClassification(original.name, decomposeToClaims(original, "offline-classifier-v1"));
    expect(reassembled.universal.warmth.value).toBe(original.universal.warmth.value);
    expect(reassembled.universal.upf.value).toBe(original.universal.upf.value);
    expect(reassembled.multilabel.activity_fit).toEqual(original.multilabel.activity_fit);
    // The load-bearing regression: the manufacturer DWR finish is NOT erased by the round-trip; it deep-
    // equals the original, source preserved (against the old code this returned [] — the data-loss bug).
    expect(reassembled.treatments).toEqual(original.treatments);
    expect(reassembled.treatments).toEqual(MFR_DWR);
    expect(reassembled.treatments[0]!.source).toBe("manufacturer");
  });

  it("a MANUFACTURER treatment beats an INFERRED one on re-assembly (precedence via resolveFacet)", () => {
    // Both an inferred and a manufacturer treatments claim reach the assembler: the manufacturer set wins
    // wholesale (whole-array atomic claim), so the resolved treatments carry the authoritative finish.
    const inferred = [{ kind: "dwr", condition: "degraded", source: "inferred", evidence: "guess" }];
    const reassembled = assembleClassification("Both Sources", [
      claim({ facetKey: TREATMENTS_FACET_KEY, value: inferred, source: "inferred", confidence: "high" }),
      claim({ facetKey: TREATMENTS_FACET_KEY, value: MFR_DWR, source: "manufacturer", confidence: "high", evidence: "stated" }),
    ]);
    expect(reassembled.treatments).toEqual(MFR_DWR);
    expect(reassembled.treatments[0]!.source).toBe("manufacturer");
    expect(reassembled.treatments[0]!.condition).toBe("factory_fresh");
  });
});
