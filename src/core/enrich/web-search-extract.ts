// Web-search-backed product enrichment extractor — the universal fallback for manufacturer-URL enrichment.
//
// When a direct page fetch is bot-walled (Patagonia, REI, The North Face, etc.), Claude's server-side
// web-search tool retrieves specs from the search index instead. The load-bearing honesty requirement:
// a fact may ONLY be tagged `manufacturer` when it is genuinely cited to an allowlisted
// manufacturer/retailer page — the authority comes from the CITATION, not from the model.
//
// PURE CORE: receives an Anthropic client (never constructs one, never reads env). May import zod,
// the Anthropic SDK type, and sibling core modules only. NEVER throws on any input.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODEL_ID } from "../config";
import { toLlmUsage, type LlmUsage } from "../obs/log";
import { validateEnrichUrl, MANUFACTURER_ALLOWLIST } from "./url-gate";
import type { ExtractedProduct } from "./parse-html";

// ---------------------------------------------------------------------------
// Exported interface
// ---------------------------------------------------------------------------

export interface WebSearchExtractDeps {
  anthropic: Anthropic;
  /** Default: MODEL_ID */
  model?: string;
  onUsage?: (usage: LlmUsage) => void;
  /** Default: MANUFACTURER_ALLOWLIST */
  allowlist?: readonly string[];
}

export interface WebSearchResult {
  /**
   * ExtractedProduct with source:"web-search" when a valid allowlisted citation was found; else an
   * EMPTY extraction (source:"none"). The caller only routes this through toManufacturerEvidence when
   * sourceUrl != null.
   */
  extracted: ExtractedProduct;
  /**
   * The validated, allowlisted source URL the specs were cited to — or null when nothing qualified.
   */
  sourceUrl: string | null;
}

// ---------------------------------------------------------------------------
// Zod schema for the model's JSON reply (rule #2: validate BEFORE any use)
// ---------------------------------------------------------------------------

const FiberSchema = z.object({
  fiber: z.string(),
  pct: z.number().nullable().default(null),
  recycled: z.boolean().default(false),
});

const SpecSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const WebSearchExtractionSchema = z.object({
  found: z.boolean(),
  brand: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  price_usd: z.number().nullable().default(null),
  weight_grams: z.number().nullable().default(null),
  material: z.string().nullable().default(null),
  fibers: z.array(FiberSchema).default([]),
  specs: z.array(SpecSchema).default([]),
  source_url: z.string().nullable().default(null),
});

type WebSearchExtraction = z.infer<typeof WebSearchExtractionSchema>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const EMPTY_WEBSEARCH: ExtractedProduct = {
  name: null,
  brand: null,
  sku: null,
  mpn: null,
  price_cents: null,
  price_currency: null,
  weight_grams: null,
  material_raw: null,
  fiber_components: [],
  specs: [],
  source: "none",
};

/**
 * Normalize an origin+pathname (lowercase, no trailing slash) for stable URL comparison. Used in the
 * citation gate to check whether the model's source_url was actually returned by the search tool.
 */
function normalizeUrlKey(raw: string): string {
  try {
    const u = new URL(raw);
    let pathname = u.pathname;
    if (pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return (u.origin + pathname).toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/$/, "");
  }
}

/**
 * Extract the JSON object from the model's text output. Tolerates a ```json fence. Returns the raw
 * parsed value (unknown) on success, or null on any parse failure.
 */
function extractJsonFromText(text: string): unknown {
  // Strip optional ```json fence
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Build the ExtractedProduct from a validated WebSearchExtraction. The caller is responsible for
 * ensuring sourceUrl != null before calling; source is set to "web-search".
 */
function toExtractedProduct(parsed: WebSearchExtraction): ExtractedProduct {
  // price_cents: dollars → integer cents, only if finite and positive
  const price_usd = parsed.price_usd;
  const price_cents =
    typeof price_usd === "number" && Number.isFinite(price_usd) && price_usd > 0
      ? Math.round(price_usd * 100)
      : null;

  // weight_grams: only if finite and positive
  const rawWeight = parsed.weight_grams;
  const weight_grams =
    typeof rawWeight === "number" && Number.isFinite(rawWeight) && rawWeight > 0
      ? rawWeight
      : null;

  // material_raw: only a non-empty string
  const material_raw =
    typeof parsed.material === "string" && parsed.material.trim() !== ""
      ? parsed.material.trim()
      : null;

  // fiber_components: drop entries without a usable string fiber; coerce pct to finite|null
  const fiber_components = (parsed.fibers ?? [])
    .filter((f) => typeof f.fiber === "string" && f.fiber.trim() !== "")
    .map((f) => ({
      fiber: f.fiber.trim(),
      pct: typeof f.pct === "number" && Number.isFinite(f.pct) ? f.pct : null,
      recycled: f.recycled === true,
    }));

  // specs: only entries where both name and value are non-empty strings
  const specs = (parsed.specs ?? []).filter(
    (s) =>
      typeof s.name === "string" &&
      s.name.trim() !== "" &&
      typeof s.value === "string" &&
      s.value.trim() !== "",
  );

  return {
    name: typeof parsed.model === "string" && parsed.model.trim() !== "" ? parsed.model.trim() : null,
    brand: typeof parsed.brand === "string" && parsed.brand.trim() !== "" ? parsed.brand.trim() : null,
    sku: null,
    mpn: null,
    price_cents,
    price_currency: price_cents !== null ? "USD" : null,
    weight_grams,
    material_raw,
    fiber_components,
    specs,
    source: "web-search",
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Use Claude's server-side web-search tool to find authoritative product specs for the given product.
 * Returns an ExtractedProduct with source:"web-search" only when specs are genuinely cited to an
 * allowlisted manufacturer/retailer URL that was actually returned by the search tool (citation gate).
 * NEVER throws — any network error, SDK throw, or validation failure returns the EMPTY result.
 */
export async function extractViaWebSearch(
  query: { name?: string | null; url?: string | null },
  deps: WebSearchExtractDeps,
): Promise<WebSearchResult> {
  const model = deps.model ?? MODEL_ID;
  const allowlist = deps.allowlist ?? MANUFACTURER_ALLOWLIST;
  const EMPTY_RESULT: WebSearchResult = { extracted: { ...EMPTY_WEBSEARCH }, sourceUrl: null };

  // Build prompts
  const productDesc: string[] = [];
  if (query.name && query.name.trim() !== "") productDesc.push(`Product name: ${query.name.trim()}`);
  if (query.url && query.url.trim() !== "") productDesc.push(`Product URL: ${query.url.trim()}`);
  if (productDesc.length === 0) return EMPTY_RESULT;

  const system =
    "You are a product specification research assistant. Your job is to find AUTHORITATIVE, manufacturer-confirmed product specifications using web search.\n" +
    "CRITICAL RULES:\n" +
    "1. Report ONLY facts actually present in the search results you retrieve. Do NOT guess or infer.\n" +
    "2. Use null for any field not found in search results.\n" +
    "3. source_url MUST be the exact manufacturer or retailer product-page URL where the specs came from.\n" +
    "4. price_usd must be in US dollars as a number (e.g. 189.00).\n" +
    "5. weight_grams must be the numeric weight in grams.\n" +
    "6. Never fabricate specifications.";

  const user =
    `Find authoritative product specifications for the following product:\n${productDesc.join("\n")}\n\n` +
    "Search for this product on manufacturer and retailer websites. Then reply with ONLY a JSON object in a fenced ```json block with this exact structure:\n" +
    "```json\n" +
    "{\n" +
    '  "found": true,\n' +
    '  "brand": "string or null",\n' +
    '  "model": "string or null",\n' +
    '  "price_usd": number or null,\n' +
    '  "weight_grams": number or null,\n' +
    '  "material": "string or null",\n' +
    '  "fibers": [{"fiber": "string", "pct": number or null, "recycled": boolean}],\n' +
    '  "specs": [{"name": "string", "value": "string"}],\n' +
    '  "source_url": "the exact manufacturer/retailer product page URL where these specs came from, or null"\n' +
    "}\n" +
    "```\n\n" +
    "If you cannot find reliable specs, set found to false and all other fields to null/[].";

  // Build the web_search tool definition. allowed_domains restricts results to the allowlist; OPEN MODE
  // (ADR-0029: empty allowlist) OMITS it so the search spans the whole web — universal product coverage
  // for any brand. The citation gate below still requires the model's source_url to be a URL the search
  // tool ACTUALLY returned (anti-hallucination ground truth), so a spec is never invented, restricted or
  // not. (web_search has no SSRF surface — Claude's server fetches, not ours.)
  const webSearchTool: Record<string, unknown> = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
  };
  if (allowlist.length > 0) webSearchTool.allowed_domains = [...allowlist];

  try {
    // Initial messages
    const userMessage: Anthropic.Messages.MessageParam = { role: "user", content: user };
    let messages: Anthropic.Messages.MessageParam[] = [userMessage];

    // Collect all response content across loop iterations (for text extraction + real URL collection)
    const allResponses: Anthropic.Messages.Message[] = [];

    // pause_turn loop — server tools may return stop_reason:"pause_turn"; cap at 4 iterations
    const MAX_ITERATIONS = 4;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // The web_search_20260209 tool may be newer than the installed SDK's typed ToolUnion — cast the
      // single tool literal (not the whole client), so the response keeps its full `Message` typing.
      const response = await deps.anthropic.messages.create({
        model,
        max_tokens: 2048,
        system,
        messages,
        tools: [webSearchTool as unknown as Anthropic.Messages.ToolUnion],
      });

      // Accumulate usage
      deps.onUsage?.(toLlmUsage(model, response.usage));

      allResponses.push(response);

      if (response.stop_reason !== "pause_turn") {
        break;
      }

      // Re-send with original user message + current assistant response for continuation
      messages = [
        userMessage,
        { role: "assistant", content: response.content },
      ];
    }

    // Collect REAL result URLs from all web_search_tool_result blocks (anti-hallucination ground truth)
    const realResultUrls = new Set<string>();
    for (const response of allResponses) {
      for (const block of response.content) {
        if (
          block &&
          typeof block === "object" &&
          (block as unknown as Record<string, unknown>).type === "web_search_tool_result"
        ) {
          const wsBlock = block as unknown as Record<string, unknown>;
          const content = wsBlock.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item && typeof item === "object") {
                const url = (item as Record<string, unknown>).url;
                if (typeof url === "string" && url.trim() !== "") {
                  realResultUrls.add(url.trim());
                }
              }
            }
          }
        }
      }
    }

    // Collect text from all responses
    const allText = allResponses
      .flatMap((r) =>
        r.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
          .map((b) => b.text),
      )
      .join("\n");

    // Parse the JSON reply
    const rawJson = extractJsonFromText(allText);
    if (rawJson === null) return EMPTY_RESULT;

    const parsed = WebSearchExtractionSchema.safeParse(rawJson);
    if (!parsed.success) return EMPTY_RESULT;

    const extraction = parsed.data;

    // Citation gate (the honesty keystone):
    // 1. source_url must be a non-empty string
    // 2. it must match one of the REAL result URLs (normalized origin+pathname)
    // 3. validateEnrichUrl must pass (allowlist + https + no IP/port/creds)
    let sourceUrl: string | null = null;

    const claimedUrl = extraction.source_url;
    if (typeof claimedUrl === "string" && claimedUrl.trim() !== "") {
      const claimedNorm = normalizeUrlKey(claimedUrl);

      // Check against real result URLs
      let foundInResults = false;
      for (const realUrl of realResultUrls) {
        if (normalizeUrlKey(realUrl) === claimedNorm) {
          foundInResults = true;
          break;
        }
      }

      if (foundInResults) {
        const validated = validateEnrichUrl(claimedUrl, allowlist);
        if (validated.ok) {
          sourceUrl = validated.url;
        }
      }
    }

    if (sourceUrl === null) {
      return EMPTY_RESULT;
    }

    // Map to ExtractedProduct with source:"web-search"
    const extracted = toExtractedProduct(extraction);

    return { extracted, sourceUrl };
  } catch {
    // Network errors, SDK throws, or any unexpected exception → return empty, never throw out
    return EMPTY_RESULT;
  }
}
