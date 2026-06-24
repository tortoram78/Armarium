import { describe, it, expect } from "vitest";
import { deriveDisplayTags } from "@/core/tags";
import { mkResolved, s, h } from "./helpers";

// Pull a UniversalFacets block out of the shared resolved-item builder.
const u = (over: Parameters<typeof mkResolved>[2]) => mkResolved("x", "x", over).universal;
const labels = (over: Parameters<typeof mkResolved>[2]) => deriveDisplayTags(u(over)).map((t) => t.label);

describe("deriveDisplayTags — hard professional tags from graded facets (no marketing slop)", () => {
  it("waterproof/windproof hardshell → Waterproof + Windproof, never the lower tiers", () => {
    const tags = labels({
      waterproofness: s("wp_breathable", "high", "manufacturer", "3L membrane"),
      wind_resistance: s("windproof", "high", "manufacturer", "membrane"),
      breathability: s("moderate", "medium", "inferred", "hardshell"),
    });
    expect(tags).toContain("Waterproof");
    expect(tags).toContain("Windproof");
    // Graded tiers are mutually exclusive: a true membrane never also reads "Water-resistant".
    expect(tags).not.toContain("Water-resistant");
    expect(tags).not.toContain("Wind-resistant");
    // breathability `moderate` is below the `high` gate → no Breathable claim.
    expect(tags).not.toContain("Breathable");
  });

  it("DWR sun hoody → water/wind RESISTANT tier + breathable/wicking/quick-dry/UPF, ordered by priority", () => {
    const tags = labels({
      waterproofness: s("dwr", "high", "manufacturer", "DWR, explicitly not waterproof"),
      wind_resistance: s("wind_resistant", "medium", "inferred", "tight woven"),
      breathability: s("high", "high", "inferred", "lightweight woven"),
      moisture_management: s("wicks", "medium", "inferred", "polyester"),
      dry_speed: s("fast", "high", "manufacturer", "fast-drying"),
      warmth: s("minimal", "high", "inferred", "single layer"),
      upf: h(40, "manufacturer", "40 UPF stated"),
    });
    // Exact order locks the priority sort (UPF 80 > resistant tiers > breathable > wicking > quick-dry).
    expect(tags).toEqual(["UPF 40", "Water-resistant", "Wind-resistant", "Breathable", "Wicking", "Quick-dry"]);
    expect(tags).not.toContain("Waterproof");
    expect(tags).not.toContain("Windproof");
    expect(tags).not.toContain("Insulated");
  });

  it("synthetic puffy → Insulated + Warm when wet + Packable", () => {
    const tags = labels({
      warmth: s("high", "high", "inferred", "lofted synthetic"),
      warmth_when_wet: s("retains", "high", "inferred", "synthetic hold-warmth-wet"),
      packability: s("ultra_packable", "high", "manufacturer", "stuffs to its pocket"),
    });
    expect(tags).toEqual(["Insulated", "Warm when wet", "Packable"]);
  });

  it("HONESTY: a low-confidence facet never hardens into a tag, and all-unknown yields nothing", () => {
    // wp_breathable but only LOW confidence → no "Waterproof" claim (mirrors the capability gate).
    expect(labels({ waterproofness: s("wp_breathable", "low", "inferred", "guess") })).not.toContain("Waterproof");
    // An item with every universal facet unknown shows no tags at all (no invented labels).
    expect(deriveDisplayTags(u({}))).toEqual([]);
    // UPF below the 30 floor is not a sun-protection claim.
    expect(labels({ upf: h(15, "manufacturer", "UPF 15") })).not.toContain("UPF 15");
  });
});
