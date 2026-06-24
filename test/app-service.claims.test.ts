// END-TO-END tests for the claims pipeline wired through app-service (Phase 3 — ADR-0014 §3/§5), all
// hermetic (in-memory repo, no DB, no API key). The decisive properties:
//   - ONLINE claims path: a mock LLM emits CLAIMS → the draft carries the RESOLVED ItemClassification,
//     item_evidence is populated with the claims, and unresolvedQuestions are surfaced on the draft.
//   - a manufacturer + derived + inferred claim set resolves correctly through enrichFromUrlToDraft
//     (manufacturer identity/composition out-rank inference via the resolver; chemistry derives behavior).
//   - the user-correction re-resolve path writes a source:"user" claim and re-resolves WITHOUT the LLM,
//     flipping the resolved facet (and a capability-relevant value).
//   - OFFLINE/cache items still get a degraded evidence trail.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  classifyToDraft,
  enrichFromUrlToDraft,
  correctItemFromClaims,
  getItem,
} from "@/server/app-service";
import { memoryRepository as repo } from "@/server/memory-repo";
import type { ClassifierHandle, Classifier } from "@/server/services";
import type { LlmClaimsOutput } from "@/core/classify/claims";
import type { ItemClassification } from "@/core/classification";
import { unknownBehavioralClassification } from "@/core/enrich";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/enrich/${name}`, import.meta.url)), "utf8");
const okFetcher = (html: string) => async () => ({ ok: true as const, html, finalUrl: "https://x/y" });

/** A mock ONLINE (claims) classifier handle — emits a fixed claims object so the claims path is hermetic. */
const claimsHandle = (output: LlmClaimsOutput): ClassifierHandle => ({
  kind: "claims",
  mode: "live",
  classify: async ({ name }) => ({ ...output, name }),
});

describe("classifyToDraft — ONLINE claims path (mock LLM emits claims)", () => {
  it("resolves the draft from claims, populates item_evidence, and surfaces unresolvedQuestions", async () => {
    const userId = randomUUID();
    const output: LlmClaimsOutput = {
      name: "Acme Sun Hoody",
      claims: [
        { facetKey: "universal.warmth", value: "minimal", confidence: "high", source: "inferred", evidence: "single-layer sun hoody" },
        { facetKey: "universal.waterproofness", value: "dwr", confidence: "medium", source: "inferred", evidence: "woven poly + DWR" },
        { facetKey: "multilabel.function_purpose", value: ["sun_protection"], confidence: "high", source: "inferred", evidence: "sun hoody" },
        // An INFERRED hard fact: must be dropped at ingestion (never reaches evidence or the resolved view).
        { facetKey: "universal.upf", value: 40, confidence: "high", source: "inferred", evidence: "guessed sunny" },
      ],
      unresolvedQuestions: ["exact weight not stated"],
    };

    const { item, unresolvedQuestions } = await classifyToDraft(
      "Acme Sun Hoody",
      "lightweight woven sun hoody",
      true,
      userId,
      { classifier: claimsHandle(output) },
    );

    // The draft carries the RESOLVED ItemClassification (the unchanged downstream shape).
    const c = item.classification;
    expect(c.universal.warmth).toMatchObject({ value: "minimal", source: "inferred" });
    expect(c.universal.waterproofness).toMatchObject({ value: "dwr", source: "inferred" });
    expect(c.multilabel.function_purpose).toEqual(["sun_protection"]);
    // The inferred hard fact was demoted — it does NOT appear in the resolved view.
    expect(c.universal.upf.value).toBeNull();

    // unresolvedQuestions are surfaced on the draft/review payload.
    expect(unresolvedQuestions).toEqual(["exact weight not stated"]);

    // item_evidence is populated with the surviving claims (and NOT the dropped inferred hard fact).
    const evidence = await repo.getItemEvidence(userId, item.id);
    const keys = evidence.map((e) => e.facetKey).sort();
    expect(keys).toContain("universal.warmth");
    expect(keys).toContain("universal.waterproofness");
    expect(keys).toContain("multilabel.function_purpose");
    expect(keys).not.toContain("universal.upf"); // the inferred hard fact has nowhere to live
    // Every persisted LLM claim is source:"inferred" with the claims extractor version.
    const warmth = evidence.find((e) => e.facetKey === "universal.warmth")!;
    expect(warmth.source).toBe("inferred");
    expect(warmth.extractorVersion).toBe("llm-claims-v1");

    // The persisted draft (round-tripped through the repo) matches.
    const fetched = await getItem(item.id, userId);
    expect(fetched!.classification.universal.warmth.value).toBe("minimal");
  });

  it("derives behavior from a STATED composition claim and records derived_from_material in evidence", async () => {
    const userId = randomUUID();
    // The LLM (wrongly) infers wicks/fast for a cotton tee but states the cotton composition; the
    // derivation must correct moisture_management to absorbs_holds and that derived claim is persisted.
    const output: LlmClaimsOutput = {
      name: "Cotton Tee",
      claims: [
        { facetKey: "universal.moisture_management", value: "wicks", confidence: "high", source: "inferred", evidence: "looks athletic" },
        {
          facetKey: "materials",
          value: [
            { role: "shell", name: "100% cotton", fiber_components: [{ fiber: "cotton", pct: 100 }], construction_type: "knit", source: "manufacturer", evidence: "100% cotton" },
          ],
          confidence: "high",
          source: "inferred",
          evidence: "stated composition",
        },
      ],
      unresolvedQuestions: [],
    };

    const { item } = await classifyToDraft("Cotton Tee", "100% cotton tee", true, userId, {
      classifier: claimsHandle(output),
    });

    // Chemistry corrected the LLM's guess: cotton absorbs/holds, now derived-sourced.
    expect(item.classification.universal.moisture_management).toMatchObject({
      value: "absorbs_holds",
      source: "derived_from_material",
    });

    // Both the LLM inferred claim AND the derived claim are in the evidence trail (losing + winning).
    const evidence = await repo.getItemEvidence(userId, item.id);
    const moisture = evidence.filter((e) => e.facetKey === "universal.moisture_management");
    expect(moisture.some((e) => e.source === "inferred")).toBe(true);
    expect(moisture.some((e) => e.source === "derived_from_material")).toBe(true);
  });
});

describe("enrichFromUrlToDraft — manufacturer + inferred + derived claims resolve through the resolver", () => {
  /** An offline-style resolved classifier (the established enrich seam): all-unknown behavioral. */
  const echoClassifier: Classifier = async ({ name }): Promise<ItemClassification> =>
    unknownBehavioralClassification(name);

  it("manufacturer identity/composition win; the draft + item_evidence reflect the resolved set", async () => {
    const userId = randomUUID();
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")),
      classify: echoClassifier,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const item = await getItem(result.draftId, userId);
    const c = item!.classification;
    // Manufacturer identity won (authoritative, survived where an inferred hard fact would be demoted).
    expect(c.identity.brand).toMatchObject({ value: "Patagonia", source: "manufacturer" });
    expect(c.identity.price_cents).toMatchObject({ value: 23900, source: "manufacturer" });
    // Manufacturer composition won wholesale.
    expect(c.materials[0]!.source).toBe("manufacturer");
    const poly = c.materials[0]!.fiber_components.find((f) => f.fiber === "polyester");
    expect(poly?.recycled).toBe(true);

    // item_evidence carries the manufacturer claims (identity + composition) with source:"manufacturer".
    const evidence = await repo.getItemEvidence(userId, result.draftId);
    const brand = evidence.find((e) => e.facetKey === "identity.brand");
    expect(brand).toMatchObject({ source: "manufacturer", value: "Patagonia" });
    expect(brand!.extractorVersion).toBe("manufacturer-url-v1");
    expect(brand!.sourceUrl).toContain("patagonia.com");
    // The composition is recorded as a manufacturer materials claim, and polyester chemistry derived a
    // moisture/dry_speed claim (derived_from_material) — so even with an all-unknown classifier, the
    // stated fabric yields behavior.
    expect(evidence.some((e) => e.facetKey === "materials" && e.source === "manufacturer")).toBe(true);
    expect(evidence.some((e) => e.source === "derived_from_material")).toBe(true);
  });

  it("DEGRADED classify (classifier throws) still resolves manufacturer facts + composition-derived behavior", async () => {
    const userId = randomUUID();
    const throwingClassifier: Classifier = async ({ name }) => {
      throw new Error(`Offline classifier only knows the prototype corpus. ${name}`);
    };
    const result = await enrichFromUrlToDraft(userId, "https://www.patagonia.com/product/nano-puff", {
      fetchHtml: okFetcher(fixture("product-jsonld.html")),
      classify: throwingClassifier,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const c = (await getItem(result.draftId, userId))!.classification;
    expect(c.identity.brand.value).toBe("Patagonia");
    expect(c.materials[0]!.source).toBe("manufacturer");
    // The evidence trail survives the classifier failure (manufacturer claims + derived chemistry).
    const evidence = await repo.getItemEvidence(userId, result.draftId);
    expect(evidence.some((e) => e.facetKey === "identity.brand" && e.source === "manufacturer")).toBe(true);
  });
});

describe("correctItemFromClaims — user correction re-resolves from claims WITHOUT the LLM", () => {
  it("a user claim out-ranks the inferred value and the re-resolved item reflects it", async () => {
    const userId = randomUUID();
    // Seed an item via the online claims path (inferred warmth = minimal).
    const output: LlmClaimsOutput = {
      name: "Correctable Hoody",
      claims: [
        { facetKey: "universal.warmth", value: "minimal", confidence: "high", source: "inferred", evidence: "thin" },
        { facetKey: "universal.waterproofness", value: "dwr", confidence: "medium", source: "inferred", evidence: "DWR" },
      ],
      unresolvedQuestions: [],
    };
    const { item } = await classifyToDraft("Correctable Hoody", undefined, true, userId, {
      classifier: claimsHandle(output),
    });
    expect(item.classification.universal.warmth.value).toBe("minimal");

    // The user corrects warmth → "high" AND sets the hard fact upf → 50 (authoritative, survives demotion).
    const corrected = await correctItemFromClaims(item.id, {
      "universal.warmth": "high",
      "universal.upf": "50",
    }, userId);

    expect(corrected).not.toBeNull();
    // The user value won over the inferred one (no LLM was called).
    expect(corrected!.classification.universal.warmth).toMatchObject({ value: "high", source: "user" });
    // A user-set HARD fact is authoritative and survives — it would flip a capability outcome.
    expect(corrected!.classification.universal.upf).toMatchObject({ value: 50, source: "user" });
    // The other inferred facet is untouched.
    expect(corrected!.classification.universal.waterproofness.value).toBe("dwr");

    // item_evidence now contains the user claims (and retains the prior inferred claims as losing claims).
    const evidence = await repo.getItemEvidence(userId, item.id);
    const warmthClaims = evidence.filter((e) => e.facetKey === "universal.warmth");
    expect(warmthClaims.some((e) => e.source === "user" && e.value === "high")).toBe(true);
    expect(warmthClaims.some((e) => e.source === "inferred")).toBe(true);
    expect(evidence.some((e) => e.facetKey === "universal.upf" && e.source === "user")).toBe(true);
  });

  it("a re-correction supersedes the user's OWN earlier claim for the same facet", async () => {
    const userId = randomUUID();
    const { item } = await classifyToDraft("Twice Corrected", undefined, true, userId, {
      classifier: claimsHandle({
        name: "Twice Corrected",
        claims: [{ facetKey: "universal.warmth", value: "minimal", confidence: "high", source: "inferred", evidence: "thin" }],
        unresolvedQuestions: [],
      }),
    });

    await correctItemFromClaims(item.id, { "universal.warmth": "moderate" }, userId);
    const second = await correctItemFromClaims(item.id, { "universal.warmth": "very_high" }, userId);
    expect(second!.classification.universal.warmth.value).toBe("very_high");

    // Exactly ONE user warmth claim survives (the latest), not two.
    const evidence = await repo.getItemEvidence(userId, item.id);
    const userWarmth = evidence.filter((e) => e.facetKey === "universal.warmth" && e.source === "user");
    expect(userWarmth.length).toBe(1);
    expect(userWarmth[0]!.value).toBe("very_high");
  });

  it("corrects a SEED item that has NO prior evidence rows — without erasing its other facets (§5/§6)", async () => {
    const userId = randomUUID();
    // A seeded item exists with a resolved classification but no item_evidence (no backfill — ADR-0014 §6).
    const seed = (await repo.listItems(userId)).find((i) => i.classification.groups.insulation || i.classification.universal.warmth.value != null)!;
    expect(seed).toBeDefined();
    expect(await repo.getItemEvidence(userId, seed.id)).toEqual([]); // truly no prior evidence
    const beforeWaterproof = seed.classification.universal.waterproofness.value;

    // Correct exactly one facet; the decompose-fallback must preserve every OTHER facet.
    const corrected = await correctItemFromClaims(seed.id, { "universal.warmth": "very_high" }, userId);
    expect(corrected!.classification.universal.warmth).toMatchObject({ value: "very_high", source: "user" });
    // An untouched facet survived the re-resolve (it was decomposed from the existing classification first).
    expect(corrected!.classification.universal.waterproofness.value).toBe(beforeWaterproof);
    // Evidence is now populated (the decomposed trail + the user claim).
    const evidence = await repo.getItemEvidence(userId, seed.id);
    expect(evidence.some((e) => e.facetKey === "universal.warmth" && e.source === "user")).toBe(true);
    expect(evidence.length).toBeGreaterThan(1);
  });

  it("returns the item unchanged when no asserting user claim is provided (no-op safe)", async () => {
    const userId = randomUUID();
    const { item } = await classifyToDraft("NoOp Item", undefined, true, userId, {
      classifier: claimsHandle({
        name: "NoOp Item",
        claims: [{ facetKey: "universal.warmth", value: "light", confidence: "high", source: "inferred", evidence: "x" }],
        unresolvedQuestions: [],
      }),
    });
    const out = await correctItemFromClaims(item.id, { "universal.warmth": "" }, userId); // blank = clear = no claim
    expect(out!.classification.universal.warmth.value).toBe("light"); // unchanged
  });
});
