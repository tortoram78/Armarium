import { describe, it, expect } from "vitest";
import { evaluateCapability } from "@/core/capabilities";
import { mkResolved, s, h } from "./helpers";

describe("capability 3-state evaluation", () => {
  it("rain_protection: waterproof-breathable satisfies, DWR fails, unknown blocks", () => {
    const wp = mkResolved("a", "shell", { waterproofness: s("wp_breathable", "high", "manufacturer", "membrane") });
    expect(evaluateCapability(wp, "rain_protection")).toBe("satisfies");

    const dwr = mkResolved("b", "hoody", { waterproofness: s("dwr", "high", "manufacturer", "DWR only") });
    expect(evaluateCapability(dwr, "rain_protection")).toBe("fails");

    const unknown = mkResolved("c", "mystery"); // waterproofness unknown
    expect(evaluateCapability(unknown, "rain_protection")).toBe("blocked_unknown");
  });

  it("a low-confidence deciding facet blocks rather than passing", () => {
    const lowConf = mkResolved("d", "maybe-shell", { waterproofness: s("wp_breathable", "low", "inferred", "guess") });
    expect(evaluateCapability(lowConf, "rain_protection")).toBe("blocked_unknown");
  });

  it("weather_shell: DWR + non-windproof fails (water-resistant != shell)", () => {
    const terreLike = mkResolved("e", "sun hoody", {
      waterproofness: s("dwr", "high", "manufacturer", "DWR"),
      wind_resistance: s("wind_resistant", "medium", "inferred", "woven"),
    });
    expect(evaluateCapability(terreLike, "weather_shell")).toBe("fails");
  });

  it("wicking_base: synthetic base satisfies; cotton-blend fails; sun hoody (minimal warmth) fails", () => {
    const merino = mkResolved("f", "merino base", {
      moisture_management: s("wicks", "high", "inferred", "merino"),
      warmth_when_wet: s("retains", "high", "inferred", "wool"),
      warmth: s("moderate", "medium", "inferred", "midweight"),
    }, { layering_role: ["base", "next_to_skin"] });
    expect(evaluateCapability(merino, "wicking_base")).toBe("satisfies");

    const cotton = mkResolved("g", "cotton tee", {
      moisture_management: s("absorbs_holds", "high", "inferred", "cotton"),
      warmth: s("light", "medium", "inferred", "midweight"),
    }, { layering_role: ["base"] });
    expect(evaluateCapability(cotton, "wicking_base")).toBe("fails");

    const sunHoody = mkResolved("h", "sun hoody", {
      moisture_management: s("wicks", "high", "inferred", "poly"),
      warmth_when_wet: s("neutral", "medium", "inferred", "synthetic"),
      warmth: s("minimal", "high", "inferred", "single-layer"),
    }, { layering_role: ["next_to_skin"] });
    expect(evaluateCapability(sunHoody, "wicking_base")).toBe("fails");
  });

  it("packable_insulation: worn packable insulation satisfies; a sleeping bag is excluded", () => {
    const puffy = mkResolved("i", "down jacket", { packability: s("ultra_packable", "high", "manufacturer", "down") }, {
      layering_role: ["static_insulation", "standalone"],
    });
    expect(evaluateCapability(puffy, "packable_insulation")).toBe("satisfies");

    const bag = mkResolved("j", "sleeping bag", { packability: s("packable", "low", "inferred", "down") }, {
      layering_role: ["sleep_system"],
    });
    expect(evaluateCapability(bag, "packable_insulation")).toBe("fails");
  });

  it("sun_protection: UPF>=30 satisfies; otherwise needs the sun_protection function", () => {
    const upf = mkResolved("k", "sun shirt", { upf: h(40, "manufacturer", "40 UPF") });
    expect(evaluateCapability(upf, "sun_protection")).toBe("satisfies");

    const byFunction = mkResolved("l", "wide hat", {}, { function_purpose: ["sun_protection"] });
    expect(evaluateCapability(byFunction, "sun_protection")).toBe("satisfies");

    const none = mkResolved("m", "tee");
    expect(evaluateCapability(none, "sun_protection")).toBe("fails");
  });
});
