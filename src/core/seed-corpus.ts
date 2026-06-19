// The canonical seed corpus as deterministic, pre-validated classifications.
//
// These are the "known-good" classifications used (a) as test fixtures and (b) as the OFFLINE seed
// source when no ANTHROPIC_API_KEY is available. The default seed path classifies through the REAL
// pipeline (scripts/seed.ts); this file is the reproducible fallback/fixture, clearly labelled as such.
//
// The typed mkUniversal/mkMulti builders validate every facet value against the vocabulary at compile
// time, so the corpus can never drift from the ontology.

import type { ItemClassification, UniversalFacets, MultiLabelFacets } from "./classification";
import { UNKNOWN_SOFT as us, UNKNOWN_HARD as uh } from "./evidence";

type Conf = "low" | "medium" | "high";
type SoftSrc = "manufacturer" | "user" | "inferred" | "derived_from_material";
const s = <T>(value: T, confidence: Conf, source: SoftSrc, evidence: string) => ({ value, confidence, source, evidence });
const h = <T>(value: T, source: "manufacturer" | "user", evidence: string) => ({ value, source, evidence });

function universalDefaults(): UniversalFacets {
  return {
    waterproofness: us, wind_resistance: us, breathability: us, moisture_management: us,
    dry_speed: us, warmth_when_wet: us, warmth: us, packability: us, technical_vs_lifestyle: us, upf: uh,
  };
}
function multilabelDefaults(): MultiLabelFacets {
  return { layering_role: [], function_purpose: [], body_zone_covered: [], activity_fit: [], conditions_fit: [] };
}
const mkUniversal = (u: Partial<UniversalFacets>): UniversalFacets => ({ ...universalDefaults(), ...u });
const mkMulti = (m: Partial<MultiLabelFacets>): MultiLabelFacets => ({ ...multilabelDefaults(), ...m });

export interface SeedEntry {
  slug: string;
  /** The raw text a user would type to add this item (the real-pipeline input). */
  input: { name: string; text?: string };
  inInventory: boolean;
  classification: ItemClassification;
}

// ---------------------------------------------------------------------------------------------------
// Inventory items (pre-seeded into MY closet — intentionally sparse so a cold alpine plan finds gaps).
// ---------------------------------------------------------------------------------------------------

const terrePlaning: ItemClassification = {
  name: "Patagonia Stretch Terre Planing Hoody",
  identity: { brand: h("Patagonia", "manufacturer", "brand"), model: h("Stretch Terre Planing Hoody", "manufacturer", "model"), price_cents: uh, weight_grams: uh },
  materials: [{ role: "shell", name: "recycled polyester", fiber_components: [{ fiber: "polyester", pct: 100, recycled: true }], construction_type: "woven", source: "manufacturer", evidence: "100% recycled polyester" }],
  treatments: [{ kind: "dwr", condition: "factory_fresh", source: "manufacturer", evidence: "DWR finish" }],
  universal: mkUniversal({
    waterproofness: s("dwr", "high", "manufacturer", "DWR finish, explicitly NOT waterproof"),
    wind_resistance: s("wind_resistant", "medium", "inferred", "woven poly, no membrane"),
    breathability: s("high", "high", "inferred", "lightweight woven sun hoody"),
    moisture_management: s("wicks", "medium", "inferred", "polyester, watersports origin"),
    dry_speed: s("fast", "high", "manufacturer", "marketed fast-drying"),
    warmth_when_wet: s("neutral", "medium", "inferred", "thin synthetic"),
    warmth: s("minimal", "high", "inferred", "single-layer sun hoody"),
    packability: s("packable", "medium", "inferred", "thin woven"),
    technical_vs_lifestyle: s("versatile", "medium", "inferred", "technical fabric, casual styling"),
    upf: h(40, "manufacturer", "40 UPF stated"),
  }),
  multilabel: mkMulti({
    layering_role: ["next_to_skin", "standalone"],
    function_purpose: ["sun_protection", "water_resistance", "cooling"],
    body_zone_covered: ["torso", "arms", "head"],
    activity_fit: ["hiking", "watersports", "travel"],
    conditions_fit: ["warm", "hot", "high_sun"],
  }),
  groups: {},
  applicable_groups: [],
};

const keltyGalactic30: ItemClassification = {
  name: "Kelty Galactic 30",
  identity: { brand: h("Kelty", "manufacturer", "brand"), model: h("Galactic 30", "manufacturer", "model"), price_cents: uh, weight_grams: uh },
  materials: [{ role: "insulation", name: "duck down 550fp", fiber_components: [{ fiber: "down", pct: 100, recycled: false }], construction_type: "insulation_fill", source: "manufacturer", evidence: "550 fill power duck down" }],
  treatments: [],
  universal: mkUniversal({
    // A bag's outer is not a worn weather shell — assessed 'none', not left unknown.
    waterproofness: s("none", "medium", "inferred", "standard bag shell, not a worn weather shell"),
    wind_resistance: s("none", "medium", "inferred", "not a wind shell"),
    warmth_when_wet: s("collapses", "medium", "inferred", "untreated down collapses when wet"),
    warmth: s("high", "medium", "inferred", "30F-rated bag"),
    packability: s("packable", "low", "inferred", "down compresses; fill weight unknown"),
    technical_vs_lifestyle: s("versatile", "low", "inferred", "car-camping/backpacking bag"),
  }),
  multilabel: mkMulti({
    layering_role: ["sleep_system"],
    function_purpose: ["sleep", "insulation", "warmth"],
    body_zone_covered: ["torso", "legs", "feet"],
    activity_fit: ["camp", "backpacking"],
    conditions_fit: ["cold", "cool"],
  }),
  groups: {
    insulation: {
      fill_type: h("down", "manufacturer", "down fill"),
      fill_power: h(550, "manufacturer", "550 fill power"),
      fill_species: h("duck", "manufacturer", "duck down"),
      fill_weight_g: uh,
      hydrophobic_treatment: uh,
      wet_performance: s("collapses", "medium", "inferred", "untreated down"),
      warmth_for_weight: s("moderate", "low", "inferred", "550FP is mid-grade"),
    },
    sleep: {
      temp_rating_value: h(30, "manufacturer", "'30' on the label"),
      temp_rating_unit: h("F", "manufacturer", "Fahrenheit"),
      // The '30' is a marketing-style number; the EN/ISO standard is NOT certified -> never upgraded.
      temp_rating_standard: s("marketing_unknown", "low", "inferred", "'30' is a marketing number; no EN/ISO certification stated"),
      shape: s("rectangular", "low", "inferred", "Galactic line is rectangular-leaning"),
      pad_r_value_recommended: us,
    },
  },
  applicable_groups: ["insulation", "sleep"],
};

const hempHenley: ItemClassification = {
  name: "Hemp/Cotton Henley",
  identity: { brand: uh, model: h("Hemp/Cotton Henley", "user", "user-provided name"), price_cents: uh, weight_grams: h(198, "manufacturer", "~7 oz midweight") },
  materials: [{ role: "shell", name: "hemp/organic-cotton blend", fiber_components: [{ fiber: "hemp", pct: 55 }, { fiber: "cotton", pct: 45 }], construction_type: "knit", source: "manufacturer", evidence: "55% hemp / 45% organic cotton" }],
  treatments: [],
  universal: mkUniversal({
    waterproofness: s("none", "high", "inferred", "untreated knit"),
    wind_resistance: s("none", "medium", "inferred", "open knit"),
    breathability: s("high", "medium", "inferred", "knit henley"),
    moisture_management: s("absorbs_holds", "high", "inferred", "cellulosic hemp+cotton are hydrophilic"),
    dry_speed: s("slow", "high", "inferred", "cellulosic fibers dry slowly"),
    warmth_when_wet: s("collapses", "high", "inferred", "cotton/hemp lose warmth when wet ('cotton kills')"),
    warmth: s("light", "medium", "inferred", "midweight ~7oz"),
    packability: s("moderate", "low", "inferred", "midweight knit"),
    technical_vs_lifestyle: s("mostly_lifestyle", "medium", "inferred", "cotton-blend casual henley"),
  }),
  multilabel: mkMulti({
    layering_role: ["next_to_skin", "base", "standalone"],
    function_purpose: ["warmth", "lifestyle"],
    body_zone_covered: ["torso", "arms"],
    activity_fit: ["everyday", "travel"],
    conditions_fit: ["mild", "cool"],
  }),
  groups: {},
  applicable_groups: [],
};

// ---------------------------------------------------------------------------------------------------
// Catalog-only items (canonical catalog; not in MY inventory).
// ---------------------------------------------------------------------------------------------------

const r1Air: ItemClassification = {
  name: "Patagonia R1 Air Full-Zip Hoody",
  identity: { brand: h("Patagonia", "manufacturer", "brand"), model: h("R1 Air Full-Zip Hoody", "manufacturer", "model"), price_cents: h(18900, "manufacturer", "$189"), weight_grams: h(312, "manufacturer", "~11 oz") },
  materials: [{ role: "shell", name: "polyester grid fleece", fiber_components: [{ fiber: "polyester", pct: 100 }], construction_type: "grid_fleece", source: "manufacturer", evidence: "Capilene grid fleece" }],
  treatments: [],
  universal: mkUniversal({
    waterproofness: s("none", "high", "manufacturer", "no DWR"),
    wind_resistance: s("none", "medium", "inferred", "airy grid is very breathable, little wind resistance"),
    breathability: s("very_high", "high", "inferred", "open grid fleece"),
    moisture_management: s("wicks", "high", "inferred", "polyester grid, dumps moisture"),
    dry_speed: s("fast", "high", "inferred", "thin polyester"),
    warmth_when_wet: s("neutral", "medium", "inferred", "synthetic fleece"),
    warmth: s("light", "medium", "inferred", "lightweight active grid"),
    packability: s("packable", "medium", "inferred", "thin compressible fleece"),
    technical_vs_lifestyle: s("mostly_technical", "medium", "inferred", "alpine active piece"),
  }),
  multilabel: mkMulti({
    layering_role: ["next_to_skin", "active_insulation", "standalone"],
    function_purpose: ["warmth", "moisture_wicking", "insulation"],
    body_zone_covered: ["torso", "arms", "head"],
    activity_fit: ["alpine", "hiking", "climbing"],
    conditions_fit: ["cool", "cold", "high_exertion"],
  }),
  groups: {},
  applicable_groups: [],
};

const synchillaSnapT: ItemClassification = {
  name: "Patagonia Lightweight Synchilla Snap-T Pullover",
  identity: { brand: h("Patagonia", "manufacturer", "brand"), model: h("Lightweight Synchilla Snap-T Pullover", "manufacturer", "model"), price_cents: uh, weight_grams: uh },
  materials: [{ role: "shell", name: "polyester pile fleece", fiber_components: [{ fiber: "polyester", pct: 100 }], construction_type: "pile_fleece", source: "manufacturer", evidence: "Synchilla pile fleece" }],
  treatments: [],
  universal: mkUniversal({
    waterproofness: s("none", "high", "inferred", "untreated fleece"),
    wind_resistance: s("wind_resistant", "low", "inferred", "dense pile blocks some wind"),
    breathability: s("moderate", "medium", "inferred", "dense pile, lower breathability"),
    moisture_management: s("neutral", "medium", "inferred", "synthetic pile"),
    dry_speed: s("moderate", "medium", "inferred", "thicker pile"),
    warmth_when_wet: s("retains", "medium", "inferred", "synthetic fleece retains warmth wet"),
    warmth: s("moderate", "medium", "inferred", "midweight pile fleece"),
    packability: s("moderate", "low", "inferred", "pile fleece is bulkier"),
    technical_vs_lifestyle: s("mostly_lifestyle", "medium", "inferred", "lifestyle-leaning fleece"),
  }),
  multilabel: mkMulti({
    layering_role: ["mid", "static_insulation", "standalone"],
    function_purpose: ["warmth", "insulation", "lifestyle"],
    body_zone_covered: ["torso", "arms"],
    activity_fit: ["everyday", "camp", "travel"],
    conditions_fit: ["cool", "cold"],
  }),
  groups: {},
  applicable_groups: [],
};

const marsupial: ItemClassification = {
  name: "Patagonia Outdoor Everyday Marsupial",
  identity: { brand: h("Patagonia", "manufacturer", "brand"), model: h("Outdoor Everyday Marsupial", "manufacturer", "model"), price_cents: uh, weight_grams: uh },
  materials: [{ role: "shell", name: "polyester pile fleece", fiber_components: [{ fiber: "polyester", pct: 100 }], construction_type: "pile_fleece", source: "manufacturer", evidence: "pile fleece" }],
  treatments: [],
  universal: mkUniversal({
    waterproofness: s("none", "high", "inferred", "untreated fleece"),
    wind_resistance: s("wind_resistant", "low", "inferred", "dense pile"),
    breathability: s("moderate", "medium", "inferred", "pile fleece"),
    moisture_management: s("neutral", "medium", "inferred", "synthetic pile"),
    dry_speed: s("moderate", "medium", "inferred", "pile fleece"),
    warmth_when_wet: s("retains", "medium", "inferred", "synthetic fleece"),
    warmth: s("moderate", "medium", "inferred", "pile fleece pullover"),
    packability: s("moderate", "low", "inferred", "pile fleece"),
    technical_vs_lifestyle: s("mostly_lifestyle", "medium", "inferred", "everyday lifestyle piece"),
  }),
  multilabel: mkMulti({
    layering_role: ["mid", "static_insulation", "standalone"],
    function_purpose: ["warmth", "insulation", "lifestyle"],
    body_zone_covered: ["torso", "arms"],
    activity_fit: ["everyday", "camp", "travel"],
    conditions_fit: ["cool", "cold"],
  }),
  groups: {},
  applicable_groups: [],
};

export const SEED_CORPUS: SeedEntry[] = [
  { slug: "terre-planing", input: { name: "Patagonia Stretch Terre Planing Hoody", text: "100% recycled polyester, DWR + 40 UPF, not waterproof, fast-drying, watersports origin" }, inInventory: true, classification: terrePlaning },
  { slug: "kelty-galactic-30", input: { name: "Kelty Galactic 30", text: "sleeping bag; down fill, 550 fill power, duck down; '30' rating" }, inInventory: true, classification: keltyGalactic30 },
  { slug: "hemp-henley", input: { name: "Hemp/Cotton Henley", text: "55% hemp / 45% organic cotton, ~7 oz midweight" }, inInventory: true, classification: hempHenley },
  { slug: "r1-air", input: { name: "Patagonia R1 Air Full-Zip Hoody", text: "~11 oz, very breathable grid fleece, no DWR, $189" }, inInventory: false, classification: r1Air },
  { slug: "synchilla-snap-t", input: { name: "Patagonia Lightweight Synchilla Snap-T Pullover", text: "pile fleece, low breathability, lifestyle-leaning" }, inInventory: false, classification: synchillaSnapT },
  { slug: "marsupial", input: { name: "Patagonia Outdoor Everyday Marsupial", text: "pile fleece, kangaroo pocket, lifestyle-leaning" }, inInventory: false, classification: marsupial },
];

export const INVENTORY_SEED = SEED_CORPUS.filter((e) => e.inInventory);
