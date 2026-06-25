import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { extractViaWebSearch, toManufacturerEvidence } from "@/core/enrich";

// Hermetic: a FAKE Anthropic client whose `messages.create` returns canned responses — never the network.
// The citation gate is the load-bearing behavior: a fact becomes authoritative ONLY when its source_url
// was actually returned by the (mocked) search tool AND clears the allowlist.

type Block = Record<string, unknown>;

function fakeMsg(content: Block[], stop_reason = "end_turn") {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content,
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
const searchResultBlock = (...urls: string[]): Block => ({
  type: "web_search_tool_result",
  content: urls.map((url) => ({ type: "web_search_result", url, title: "t" })),
});
const textBlock = (text: string): Block => ({ type: "text", text });
const jsonText = (obj: unknown): string => "Here are the specs:\n```json\n" + JSON.stringify(obj) + "\n```";

/** A fake client that returns the given messages on successive `create` calls (last one repeats). */
function clientReturning(...msgs: ReturnType<typeof fakeMsg>[]): Anthropic {
  let i = 0;
  return {
    messages: { create: async () => msgs[Math.min(i++, msgs.length - 1)] },
  } as unknown as Anthropic;
}
/** A client whose create() rejects, to exercise the never-throw contract. */
const throwingClient = {
  messages: {
    create: async () => {
      throw new Error("network down");
    },
  },
} as unknown as Anthropic;

const PATA_URL = "https://www.patagonia.com/product/mens-nano-puff-jacket/84212.html";
const REI_URL = "https://www.rei.com/product/236427/rei-co-op-magma-850-down-jacket-mens";

describe("extractViaWebSearch — citation-gated web-search enrichment", () => {
  it("happy path (Patagonia): cited to an allowlisted, search-returned URL → authoritative web-search facts", async () => {
    const anthropic = clientReturning(
      fakeMsg([
        searchResultBlock(PATA_URL),
        textBlock(
          jsonText({
            found: true,
            brand: "Patagonia",
            model: "Nano Puff Jacket",
            price_usd: 239,
            weight_grams: 337,
            material: "100% recycled polyester",
            fibers: [{ fiber: "polyester", pct: 100, recycled: true }],
            specs: [{ name: "Fit", value: "Regular" }],
            source_url: PATA_URL,
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic });
    expect(r.sourceUrl).toBeTruthy();
    expect(r.sourceUrl).toContain("patagonia.com");
    expect(r.extracted.source).toBe("web-search");
    expect(r.extracted.brand).toBe("Patagonia");
    expect(r.extracted.weight_grams).toBe(337);
    expect(r.extracted.price_cents).toBe(23900);
    expect(r.extracted.fiber_components.find((f) => f.fiber === "polyester")?.recycled).toBe(true);

    // End-to-end honesty: the cited web-search extraction yields manufacturer-sourced hard facts.
    const ev = toManufacturerEvidence(r.extracted);
    expect(ev.hasSignal).toBe(true);
    expect(ev.identity.weight_grams.value).toBe(337);
    expect(ev.identity.weight_grams.source).toBe("manufacturer");
    expect(ev.materials[0]?.source).toBe("manufacturer");
  });

  it("happy path (REI) — second archetype, retailer domain", async () => {
    const anthropic = clientReturning(
      fakeMsg([
        searchResultBlock(REI_URL),
        textBlock(
          jsonText({
            found: true,
            brand: "REI Co-op",
            model: "Magma 850 Down Jacket",
            price_usd: 329,
            weight_grams: null,
            material: null,
            fibers: [],
            specs: [],
            source_url: REI_URL,
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: REI_URL }, { anthropic });
    expect(r.sourceUrl).toContain("rei.com");
    expect(r.extracted.brand).toBe("REI Co-op");
    expect(r.extracted.price_cents).toBe(32900);
  });

  it("FORGED citation: source_url not among the real search results → rejected (source:none)", async () => {
    const anthropic = clientReturning(
      fakeMsg([
        searchResultBlock(PATA_URL), // the search actually returned THIS url
        textBlock(
          jsonText({
            found: true,
            brand: "Patagonia",
            model: "Nano Puff",
            price_usd: 239,
            weight_grams: 337,
            material: null,
            fibers: [],
            specs: [],
            source_url: "https://www.patagonia.com/product/totally-made-up", // but the model cited a different one
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic });
    expect(r.sourceUrl).toBeNull();
    expect(r.extracted.source).toBe("none");
  });

  it("NON-ALLOWLISTED citation: a real result on a non-allowlisted host → rejected", async () => {
    const blog = "https://randomblog.com/patagonia-nano-puff-review";
    const anthropic = clientReturning(
      fakeMsg([
        searchResultBlock(blog),
        textBlock(
          jsonText({
            found: true,
            brand: "Patagonia",
            model: "Nano Puff",
            price_usd: 239,
            weight_grams: 337,
            material: null,
            fibers: [],
            specs: [],
            source_url: blog,
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic });
    expect(r.sourceUrl).toBeNull(); // validateEnrichUrl rejects the non-allowlisted host
  });

  it("malformed / missing model JSON → empty result, never throws", async () => {
    const anthropic = clientReturning(fakeMsg([searchResultBlock(PATA_URL), textBlock("no json here, sorry")]));
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic });
    expect(r.sourceUrl).toBeNull();
    expect(r.extracted.source).toBe("none");
  });

  it("SDK throw is caught → empty result, never throws out", async () => {
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic: throwingClient });
    expect(r.sourceUrl).toBeNull();
  });

  it("pause_turn loop: first turn searches, second returns the JSON; onUsage fires per turn", async () => {
    let usageCalls = 0;
    const anthropic = clientReturning(
      fakeMsg([searchResultBlock(PATA_URL)], "pause_turn"),
      fakeMsg([
        textBlock(
          jsonText({
            found: true,
            brand: "Patagonia",
            model: "Nano Puff",
            price_usd: 239,
            weight_grams: 337,
            material: null,
            fibers: [],
            specs: [],
            source_url: PATA_URL,
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic, onUsage: () => usageCalls++ });
    expect(r.sourceUrl).toContain("patagonia.com");
    expect(usageCalls).toBe(2); // one per turn
  });

  it("sanitizes junk numerics: negative price and zero weight collapse to null", async () => {
    const anthropic = clientReturning(
      fakeMsg([
        searchResultBlock(PATA_URL),
        textBlock(
          jsonText({
            found: true,
            brand: "Patagonia",
            model: "Nano Puff",
            price_usd: -5,
            weight_grams: 0,
            material: "  ",
            fibers: [{ fiber: "", pct: 50, recycled: false }],
            specs: [{ name: "", value: "x" }],
            source_url: PATA_URL,
          }),
        ),
      ]),
    );
    const r = await extractViaWebSearch({ url: PATA_URL }, { anthropic });
    expect(r.extracted.price_cents).toBeNull();
    expect(r.extracted.weight_grams).toBeNull();
    expect(r.extracted.material_raw).toBeNull();
    expect(r.extracted.fiber_components).toHaveLength(0); // empty fiber name dropped
    expect(r.extracted.specs).toHaveLength(0); // empty spec name dropped
  });

  it("empty query (no name, no url) → empty result without calling the model", async () => {
    let called = false;
    const anthropic = {
      messages: {
        create: async () => {
          called = true;
          return fakeMsg([]);
        },
      },
    } as unknown as Anthropic;
    const r = await extractViaWebSearch({}, { anthropic });
    expect(r.sourceUrl).toBeNull();
    expect(called).toBe(false);
  });
});
