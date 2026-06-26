# ADR-0028 — Enrich-by-name: web-search specs for any brand, on the quick-add path

**Status:** Accepted (owner decision 2026-06-26: "specs should come from a name, not a fragile URL
scrape"; provider = Anthropic SDK + its web-search tool, no new vendor)
**Date:** 2026-06-26
**Phase:** Closet-first pivot (see [[engine-rebuild-direction]] / roadmap "Active track"), workstream B.

---

## Context

The owner's #1 complaint: **"the fetch simply doesn't work,"** which cascades — items land all-unknown,
so every facet reads "verify/edit," so the closet is a chore and the engine has no data. Grounded cause:

1. Manufacturer-URL enrichment is gated to a **6-domain allowlist** (`src/core/enrich/url-gate.ts`).
   Any other brand is rejected at the shape gate before a byte is fetched.
2. The one path that already works from a NAME — `extractViaWebSearch` (Claude's server-side
   `web_search` tool, `src/core/enrich/web-search-extract.ts`) — was (a) restricted to those same 6
   domains via `allowed_domains` + the citation gate, and (b) only wired into the *URL* draft flow
   (`enrichFromUrlToDraft`), never the **by-name** path (`enrichItem`, behind the "Auto-fill from name"
   / "Classify now" button → `classifyNowAction`). `enrichItem` ran the inference classifier only, which
   (correctly) never fabricates hard facts, so weight/price/material stayed unknown.

Net: for the average user adding average gear, no authoritative specs ever arrived.

## Decision

Two changes, both preserving the citation-gated honesty model (a fact earns `source:"manufacturer"`
only because it was cited to an allowlisted product page that the search tool actually returned):

### A — Widen the authoritative-source allowlist
`MANUFACTURER_ALLOWLIST` grows from 6 to ~40 hosts: reputable outdoor **manufacturers** PLUS major
**retailers** (REI, Backcountry, Moosejaw, Public Lands, evo, CampSaver, Steep & Cheap). The retailers
are the long-tail coverage engine — they carry thousands of brands, so a name search resolves most
products even when the maker's own site is bot-walled or absent. The list remains a small, curated,
deliberately-extended security/authority boundary; the per-hop DNS + private-IP SSRF guards on the
direct-fetch path are unchanged, so widening it does not weaken SSRF defense.

### B — Route web-search into the by-name path (`enrichItem`)
After the classifier produces behavioral facets, `enrichItem` now also calls the env-selected
`getWebSearchEnricher()` (injectable via `ClassifyToDraftDeps.webSearch` for tests) and, when the result
carries an allowlisted **citation** (`sourceUrl != null`), overlays it via
`applyManufacturerOverlay(classification, toManufacturerEvidence(extracted))`. Manufacturer/retailer
identity (brand/model/price/weight) + composition **out-rank** inference (rule #2); behavioral facets
stay the classifier's (the overlay never asserts them). So "Auto-fill from name" now returns real specs.

## Invariant compliance
- **Never fabricate (rule #2).** Unchanged honesty keystone: specs are only authoritative when cited to
  a real, allowlisted, search-returned URL; hard facts still pass the demotion guard; behavioral facets
  are never stamped manufacturer. The model proposes; the citation gate authorizes.
- **Hermetic gate.** `getWebSearchEnricher()` is inert without `ANTHROPIC_API_KEY` (`available:false`,
  returns an empty result), so `typecheck/lint/test/build` stay green with zero env. The new
  `test/enrich-by-name.test.ts` injects a fake enricher (no network) and proves both the overlay and the
  no-citation degrade path. 663 tests green.
- **Pure core / one MODEL_ID / ask-first.** The extractor lives in pure core; the client is constructed
  only in `services.ts`; no new dependency or vendor (reuses the Anthropic SDK already in the stack).

## Consequences
- **Better:** quick-added gear can arrive with authoritative brand/weight/price/composition for any
  allowlisted brand or any product a listed retailer carries — directly attacking the all-unknown →
  verify-wall cascade. Pairs with the item-screen de-noise (specs are optional, unknown is invisible).
- **Cost / latency (flagged):** with a key, `enrichItem` now issues a web-search call per enrichment
  (the `web_search` loop is slower than a completion; the enricher uses a 50s timeout under the route's
  `maxDuration=60`). Batch enrichment (`enrichItemAction`, concurrency 3) multiplies this. **Rate-limiting
  the enrich/classify routes (workstream D) is now a near-term necessity, not optional.**
- **"Manufacturer" tier now includes major retailers** — a deliberate authority-vs-coverage trade. A
  retailer spec page is treated as authoritative; acceptable for a personal closet, and still citation-
  gated. Revisit if retailer data quality proves noisy.
- **Claims-trail caveat:** the overlay is applied to the resolved classification (the jsonb read source
  of truth), not added to the persisted `item_evidence` claim set. Harmless today (reads use the
  classification); a fuller claims-level merge (as `enrichFromUrlToDraft` does) is future work.

## Alternatives considered
- **New lower-authority `source:"web_search"` tier** instead of widening the manufacturer allowlist:
  more honest about retailer-vs-maker authority, but touches the evidence source model + to-evidence +
  merge + the demotion rules — deferred as a larger change. Widening the (already retailer-inclusive)
  allowlist reuses the existing, tested overlay path.
- **Keep URL-only enrichment, just grow the allowlist:** still forces the user to find and paste a URL,
  and still dies on bot walls. The name is the right input; web search is the right fetch.
- **Hosted scraper/search API (Scrapfly already ADR-0019):** broader still, but a new paid vendor + key.
  Held as a future booster; the no-new-vendor web-search path is the default.
