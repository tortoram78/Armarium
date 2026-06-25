// Professional display tags — a deterministic projection of the HARD graded facets into the short,
// non-marketing vocabulary a gear professional actually uses (DESIGN.md §5 display layer). This is the
// closet/spec-sheet chip surface ONLY; it is NOT a facet, NOT a capability gate, and nothing reasons
// over it. The load-bearing `function_purpose` multilabel stays exactly where it is (it still gates the
// sun_protection capability) — this module replaces the *display* of those soft labels with tags read
// straight from the ordinal facets, so a card never shows a word the facets don't support.
//
// Honesty gate: every soft-facet tag requires medium+ confidence (mirrors the capability gates in
// capabilities/index.ts). A low-confidence guess therefore never hardens into an on-card claim —
// "unknown" stays first-class (load-bearing rule #2). `upf` is the one hard fact here; a hard fact is
// authoritative-by-construction (manufacturer/user only), so a present value is shown as-is.

import type { UniversalFacets } from "./classification";
import { isConfident } from "./evidence";
import {
  WATERPROOFNESS, WIND_RESISTANCE, BREATHABILITY, DRY_SPEED, WARMTH, PACKABILITY, atLeast,
} from "./facets/levels";

export interface DisplayTag {
  /** Stable key (for React lists + tests). */
  key: string;
  /** The professional label shown to the user. */
  label: string;
}

/**
 * One derived tag: a hard professional descriptor read from ONE graded universal facet. `test` decides
 * presence (already confidence-gated); `label` is the chip text (a function only for `upf`, whose text
 * carries the real number). `priority` orders the output high→low so a card can show the top few.
 */
interface TagDef {
  key: string;
  label: string | ((u: UniversalFacets) => string);
  priority: number;
  test: (u: UniversalFacets) => boolean;
}

// Ordered conceptually by how strongly each trait defines a piece of gear; `priority` is the real sort
// key. Waterproof/Water-resistant and Windproof/Wind-resistant are graded tiers of one facet, so their
// predicates are mutually exclusive (the higher tier excludes the lower) — an item never shows both.
const TAG_DEFS: TagDef[] = [
  {
    key: "waterproof",
    label: "Waterproof",
    priority: 100,
    test: (u) => isConfident(u.waterproofness) && atLeast(WATERPROOFNESS, u.waterproofness.value, "wp_breathable"),
  },
  {
    key: "windproof",
    label: "Windproof",
    priority: 92,
    test: (u) => isConfident(u.wind_resistance) && u.wind_resistance.value === "windproof",
  },
  {
    key: "insulated",
    label: "Insulated",
    priority: 86,
    test: (u) => isConfident(u.warmth) && atLeast(WARMTH, u.warmth.value, "moderate"),
  },
  {
    key: "upf",
    // The one hard fact here — show the real rated number (e.g. "UPF 40"). Authoritative by construction.
    label: (u) => `UPF ${u.upf.value}`,
    priority: 80,
    test: (u) => u.upf.value !== null && u.upf.value >= 30,
  },
  {
    key: "water_resistant",
    label: "Water-resistant",
    priority: 74,
    // dwr / water_resistant, but strictly below a true waterproof membrane (so it never doubles up with Waterproof).
    test: (u) =>
      isConfident(u.waterproofness) &&
      atLeast(WATERPROOFNESS, u.waterproofness.value, "dwr") &&
      !atLeast(WATERPROOFNESS, u.waterproofness.value, "wp_breathable"),
  },
  {
    key: "wind_resistant",
    label: "Wind-resistant",
    priority: 70,
    test: (u) => isConfident(u.wind_resistance) && u.wind_resistance.value === "wind_resistant",
  },
  {
    key: "warm_when_wet",
    label: "Warm when wet",
    priority: 66,
    // The synthetic/fleece-vs-down distinction a pro leads with: insulation that holds warmth soaked.
    test: (u) => isConfident(u.warmth_when_wet) && u.warmth_when_wet.value === "retains",
  },
  {
    key: "breathable",
    label: "Breathable",
    priority: 60,
    test: (u) => isConfident(u.breathability) && atLeast(BREATHABILITY, u.breathability.value, "high"),
  },
  {
    key: "wicking",
    label: "Wicking",
    priority: 54,
    test: (u) => isConfident(u.moisture_management) && u.moisture_management.value === "wicks",
  },
  {
    key: "quick_dry",
    label: "Quick-dry",
    priority: 48,
    test: (u) => isConfident(u.dry_speed) && atLeast(DRY_SPEED, u.dry_speed.value, "fast"),
  },
  {
    key: "packable",
    label: "Packable",
    priority: 40,
    test: (u) => isConfident(u.packability) && atLeast(PACKABILITY, u.packability.value, "packable"),
  },
];

/**
 * Derive the professional display tags for an item's universal facets, highest-priority first. Pure +
 * deterministic; same facets in, same tags out. Returns [] when nothing clears its gate (the card then
 * shows its honest "no facets yet" state rather than inventing a label).
 */
export function deriveDisplayTags(u: UniversalFacets): DisplayTag[] {
  return TAG_DEFS.filter((d) => d.test(u))
    .sort((a, b) => b.priority - a.priority)
    .map((d) => ({ key: d.key, label: typeof d.label === "function" ? d.label(u) : d.label }));
}
