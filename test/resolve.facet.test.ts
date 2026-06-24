import { describe, it, expect } from "vitest";
import {
  resolveFacet,
  SOURCE_PRECEDENCE,
  AUTHORITATIVE_SOURCES,
  type Claim,
} from "@/core/resolve";
import type { Source, Confidence } from "@/core/evidence";

// ----------------------------------------------------------------------------------------------------
// Claim builders.
// ----------------------------------------------------------------------------------------------------
const claim = <V>(value: V | null, source: Source, confidence: Confidence | "unknown", evidence = `${source} says`): Claim<V> => ({
  value,
  confidence,
  source,
  evidence,
});
const unknownClaim = <V>(): Claim<V> => ({ value: null, confidence: "unknown", source: "unknown", evidence: "" });

// ====================================================================================================
// 0. The policy constants are the documented total order.
// ====================================================================================================
describe("SOURCE_PRECEDENCE is the documented total order", () => {
  it("orders unknown < inferred < derived_from_material < manufacturer < user", () => {
    expect([...SOURCE_PRECEDENCE]).toEqual([
      "unknown",
      "inferred",
      "derived_from_material",
      "manufacturer",
      "user",
    ]);
  });
  it("names exactly user + manufacturer as authoritative", () => {
    expect([...AUTHORITATIVE_SOURCES].sort()).toEqual(["manufacturer", "user"]);
  });
});

// ====================================================================================================
// 1. The full precedence matrix: with EQUAL confidence, the higher-precedence source always wins, for
//    every adjacent and non-adjacent pair. (Confidence held constant isolates precedence.)
// ====================================================================================================
describe("precedence matrix (equal confidence → higher precedence wins)", () => {
  const order: Source[] = ["unknown", "inferred", "derived_from_material", "manufacturer", "user"];
  // `unknown` can't assert a value, so the asserting-source matrix is the upper 4.
  const asserting: Source[] = ["inferred", "derived_from_material", "manufacturer", "user"];

  for (let hi = 0; hi < asserting.length; hi++) {
    for (let lo = 0; lo < hi; lo++) {
      const high = asserting[hi]!;
      const low = asserting[lo]!;
      it(`${high} (medium) beats ${low} (medium) regardless of argument order`, () => {
        const a = resolveFacet([claim("HI", high, "medium"), claim("LO", low, "medium")]);
        const b = resolveFacet([claim("LO", low, "medium"), claim("HI", high, "medium")]);
        expect(a.source).toBe(high);
        expect(a.value).toBe("HI");
        expect(b.source).toBe(high); // order-independent
        expect(b.value).toBe("HI");
      });
    }
  }

  it("an `unknown`-source asserting nothing never beats a real assertion", () => {
    const r = resolveFacet([unknownClaim<string>(), claim("X", "inferred", "low")]);
    expect(r.source).toBe("inferred");
    expect(r.value).toBe("X");
    expect(order.indexOf(r.source)).toBeGreaterThan(order.indexOf("unknown"));
  });
});

// ====================================================================================================
// 2. AUTHORITATIVE sources win by precedence REGARDLESS of confidence — a stated fact beats a guess.
// ====================================================================================================
describe("authoritative sources beat any guess regardless of confidence (rule #2)", () => {
  it("manufacturer(low) beats inferred(high)", () => {
    const r = resolveFacet([claim("stated", "manufacturer", "low"), claim("guessed", "inferred", "high")]);
    expect(r.source).toBe("manufacturer");
    expect(r.value).toBe("stated");
  });

  it("manufacturer(low) beats derived_from_material(high)", () => {
    const r = resolveFacet([claim("stated", "manufacturer", "low"), claim("derived", "derived_from_material", "high")]);
    expect(r.source).toBe("manufacturer");
    expect(r.value).toBe("stated");
  });

  it("user(low) beats manufacturer(high) — the owner is final", () => {
    const r = resolveFacet([claim("corrected", "user", "low"), claim("spec", "manufacturer", "high")]);
    expect(r.source).toBe("user");
    expect(r.value).toBe("corrected");
  });
});

// ====================================================================================================
// 3. The OVERRIDE exception, keyed on the higher-precedence non-authoritative claim's OWN weakness:
//    it DEFERS only when ITS OWN confidence is `low` (an acknowledged fill-only claim), regardless of
//    the other claim's confidence. A medium/high non-authoritative claim ALWAYS overrides a lower one.
// ====================================================================================================
describe("non-authoritative override exception (keyed on the claim's own low confidence)", () => {
  // The MOISTURE CORRECTION: derived (high) overrides inferred (any ≤ high).
  it("derived(high) overrides inferred(low) — the moisture correction", () => {
    const r = resolveFacet([claim("wicks", "inferred", "low"), claim("absorbs_holds", "derived_from_material", "high")]);
    expect(r.source).toBe("derived_from_material");
    expect(r.value).toBe("absorbs_holds");
  });

  it("derived(high) overrides inferred(high) — equal confidence, higher precedence still wins", () => {
    const r = resolveFacet([claim("wicks", "inferred", "high"), claim("absorbs_holds", "derived_from_material", "high")]);
    expect(r.source).toBe("derived_from_material");
    expect(r.value).toBe("absorbs_holds");
  });

  // THE HEADLINE FIX — the deceptive cellulosic (bamboo/lyocell). The library rates a cellulosic's
  // moisture_management `absorbs_holds`/MEDIUM (the physics truth: cellulose holds water when saturated).
  // A confident LLM `wicks`/HIGH is the marketing feel. Physics MUST win: a medium-confidence derivation
  // is a real position, so it overrides the higher-confidence guess. (Pre-refinement this DEFERRED — the
  // wart that handed unsafe "wicks" advice to a saturated cellulosic.)
  it("derived(medium) OVERRIDES inferred(high) — the deceptive cellulosic (bamboo/lyocell): physics wins", () => {
    const r = resolveFacet([
      claim("wicks", "inferred", "high", "feels dry, marketed as moisture-wicking"),
      claim("absorbs_holds", "derived_from_material", "medium", "regenerated cellulose; absorbent when saturated"),
    ]);
    expect(r.source).toBe("derived_from_material");
    expect(r.value).toBe("absorbs_holds");
  });

  it("the cellulosic fix is order-independent (medium-derived wins from either argument order)", () => {
    const forward = resolveFacet([
      claim("wicks", "inferred", "high"),
      claim("absorbs_holds", "derived_from_material", "medium"),
    ]);
    const reverse = resolveFacet([
      claim("absorbs_holds", "derived_from_material", "medium"),
      claim("wicks", "inferred", "high"),
    ]);
    expect(forward.source).toBe("derived_from_material");
    expect(forward.value).toBe("absorbs_holds");
    expect(reverse.source).toBe("derived_from_material");
    expect(reverse.value).toBe("absorbs_holds");
  });

  // The WARMTH FILL-ONLY case: derived (low) is acknowledged-weak (fiber alone doesn't fix warmth), so it
  // defers to ANY asserting inferred warmth — high, medium, OR low — and only fills a true gap.
  it("derived(low) does NOT override inferred(high) — it defers (the warmth case)", () => {
    const r = resolveFacet([claim("high", "inferred", "high"), claim("moderate", "derived_from_material", "low")]);
    expect(r.source).toBe("inferred");
    expect(r.value).toBe("high");
  });

  it("derived(low) does NOT override inferred(medium) — still defers (own-low is fill-only)", () => {
    const r = resolveFacet([claim("high", "inferred", "medium"), claim("moderate", "derived_from_material", "low")]);
    expect(r.source).toBe("inferred");
    expect(r.value).toBe("high");
  });

  it("derived(low) does NOT override inferred(low) — fill-only defers even to an equally-low assertion", () => {
    const r = resolveFacet([claim("high", "inferred", "low"), claim("moderate", "derived_from_material", "low")]);
    expect(r.source).toBe("inferred");
    expect(r.value).toBe("high");
  });

  it("the fill-only defer is order-independent (incumbent or challenger, same winner)", () => {
    const forward = resolveFacet([claim("high", "inferred", "high"), claim("moderate", "derived_from_material", "low")]);
    const reverse = resolveFacet([claim("moderate", "derived_from_material", "low"), claim("high", "inferred", "high")]);
    expect(forward.source).toBe("inferred");
    expect(reverse.source).toBe("inferred");
    expect(forward.value).toBe("high");
    expect(reverse.value).toBe("high");
  });

  it("derived(low) fills an UNKNOWN inferred (no competing assertion → derived stands)", () => {
    const r = resolveFacet([unknownClaim<string>(), claim("moderate", "derived_from_material", "low")]);
    expect(r.source).toBe("derived_from_material");
    expect(r.value).toBe("moderate");
  });
});

// ====================================================================================================
// 4. All-unknown / no-assertion → the canonical UNKNOWN claim (never fabricated).
// ====================================================================================================
describe("all-unknown resolves to the canonical unknown", () => {
  it("an empty claim list → unknown", () => {
    const r = resolveFacet<string>([]);
    expect(r).toMatchObject({ value: null, confidence: "unknown", source: "unknown" });
  });
  it("only non-asserting (value:null) claims → unknown", () => {
    const r = resolveFacet([unknownClaim<string>(), claim<string>(null, "inferred", "unknown")]);
    expect(r.value).toBeNull();
    expect(r.source).toBe("unknown");
  });
});

// ====================================================================================================
// 5. Ties at equal precedence resolve by confidence, then stably to the incumbent.
// ====================================================================================================
describe("ties", () => {
  it("equal precedence → higher confidence wins", () => {
    const r = resolveFacet([claim("lo", "inferred", "low"), claim("hi", "inferred", "high")]);
    expect(r.value).toBe("hi");
  });
  it("equal precedence + equal confidence → the first (incumbent) stays (stable)", () => {
    const r = resolveFacet([claim("first", "inferred", "medium", "A"), claim("second", "inferred", "medium", "B")]);
    expect(r.value).toBe("first");
  });
});

// ====================================================================================================
// 6. Auditability: the winner keeps the losing claims' provenance in its evidence trail.
// ====================================================================================================
describe("resolution stays auditable", () => {
  it("annotates the winner's evidence with the loser(s)", () => {
    const r = resolveFacet([
      claim("wicks", "inferred", "high", "looks like a synthetic base"),
      claim("absorbs_holds", "derived_from_material", "high", "cotton is hydrophilic"),
    ]);
    expect(r.value).toBe("absorbs_holds");
    expect(r.evidence).toContain("cotton is hydrophilic"); // winner's own evidence preserved
    expect(r.evidence).toContain("won over"); // trail present
    expect(r.evidence).toContain("inferred(high)"); // the loser's source + confidence
    expect(r.evidence).toContain("wicks"); // the loser's value
  });

  it("a sole winner gets no spurious trail", () => {
    const r = resolveFacet([claim("x", "inferred", "high", "only claim")]);
    expect(r.evidence).toBe("only claim");
  });
});

// ====================================================================================================
// 7. Totality: never throws on odd input (a stray/unknown-typed source ranks at the floor).
// ====================================================================================================
describe("resolveFacet is total and never throws", () => {
  it("handles a bogus source by treating it as the unknown floor", () => {
    const bogus = { value: "weird", confidence: "high", source: "from_outer_space" as Source, evidence: "?" };
    const r = resolveFacet([bogus as Claim<string>, claim("real", "inferred", "low")]);
    // A source not in the precedence map ranks NaN; the real inferred assertion must not lose to it.
    expect(r.value).toBe("real");
    expect(r.source).toBe("inferred");
  });
});
