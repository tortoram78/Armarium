# ADR-0020 — Web-search enrichment tier: manufacturer specs for every allowlisted brand (incl. Patagonia)

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Phase 3 step 2 follow-up (manufacturer URL enrichment, ADR-0011 / ADR-0019)

---

## Context

Manufacturer-URL enrichment (ADR-0011) resolves authoritative product specs from a manufacturer
page and overlays them onto LLM inferences at the highest `source` authority. ADR-0019 added
Scrapfly residential-proxy as a fallback for brands whose pages are bot-walled on Vercel's datacenter
IPs.

After ADR-0019 shipped:

- Direct fetch works for non-walled brands (Marmot, Arc'teryx, Black Diamond).
- Scrapfly residential unlocks REI + The North Face (verified live, JSON-LD extracted end-to-end).
- Patagonia remains blocked — even with asp=true, residential proxy, browser emulation, and
  retry, Scrapfly cannot clear Patagonia's Akamai configuration. ADR-0019 documented this honestly:
  "residential *is* the premium tier; a paid plan would not fix Patagonia either." Patagonia was
  left on add-by-name with no spec extraction.

Beyond Patagonia, "scrape the live page" is a structurally fragile primitive: bot walls vary per
brand and can tighten without notice; residential proxies add cost and latency; Vercel's default
~10-15 s function timeout is a race condition for a residential anti-bot bypass with JS rendering
(8-20 s); per-brand brittleness compounds with every new allowlisted brand. The product owner
approved replacing the live-page-scrape fallback with a web-search-grounded approach on 2026-06-25.

## Decision

Four-tier enrichment pipeline in `enrichFromUrlToDraft`:

  1. Direct fetch          (free, fast)
  2. Scrapfly residential  (if SCRAPFLY_KEY)
  3. Web search            (if ANTHROPIC_API_KEY — universal)
  4. Name-classify floor   (always — behavioral facets from name; hard facts stay null)

New pure-core module `src/core/enrich/web-search-extract.ts` (`extractViaWebSearch`) uses Claude's
`web_search_20260209` tool restricted to `allowed_domains: MANUFACTURER_ALLOWLIST`. The response is
validated with a Zod schema before any use.

The honesty keystone — authority comes from the citation, not the model:

- The model returns a `source_url`. It is accepted ONLY if (a) it appears among the real
  `web_search_tool_result` URLs Anthropic fetched (rejecting a hallucinated citation) AND (b) it
  passes `validateEnrichUrl` (the existing allowlist gate).
- Only citations clearing both checks route through `toManufacturerEvidence` as `source:"manufacturer"`.
  The data is manufacturer-stated — retrieved via the search index, not a blocked direct fetch.
- No change to HARD_SOURCE = {manufacturer, user}. `evidence.ts` and the resolver are untouched.
  Web search is a new retrieval path to the existing manufacturer source, not a new authority tier.
- If no allowlisted citation qualifies, the tier yields no authoritative signal and the flow falls
  through to name-classify. Unknown-is-first-class is preserved.

`maxDuration=60` is added to the `/items/new` route segment config to accommodate the slow tier on
Vercel. With no ANTHROPIC_API_KEY the tier is skipped entirely; the hermetic gate is unchanged.

## Consequences

Works for every allowlisted brand including Patagonia. Bot walls are no longer a permanent blocker.
Cost ~1-2 cents per walled item (only items where tiers 1-2 fail). ANTHROPIC_API_KEY already in
prod for classify; no new secret. Residual risk (model misattributes a spec to a real cited page)
is mitigated by: allowed_domains restriction, citation cross-check against real tool results, and
mandatory human review before save — same trust level as parsing a page's JSON-LD directly.
Scrapfly (ADR-0019) is retained as tier 1.5 and not superseded.

## Alternatives considered

(a) Residential scraping only — leaves Patagonia permanently blocked. Rejected.
(b) Relax HARD_SOURCE to add a web-search authority tier — unnecessary weakening of rule #2; the
    citation gate means the data IS manufacturer-stated. Rejected.
(c) LLM from training knowledge, no search — ungrounded; the hardFact guard demotes it correctly.
    Equivalent to an expensive name-classify call. Rejected.
(d) Always web-search, skip tiers 1-2 — non-walled brands pay per-item cost for no benefit.
    Cheapest-tier-first is correct. Rejected.
