# ADR-0019 — Residential-proxy fallback for manufacturer-URL enrichment (Scrapfly)

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Phase 3 step 2 follow-up (manufacturer URL enrichment, ADR-0011)

---

## Context

Manufacturer-URL enrichment (ADR-0011) fetches a product page server-side, extracts schema.org
Product / OpenGraph data, and resolves the authoritative manufacturer claims against the inference.
On the live Vercel deploy this "returned zero fields" for several allowlisted brands.

Root cause, verified against the real responses (not assumed):

- The direct fetcher sent no `User-Agent` (fixed separately) — but more fundamentally, **Patagonia,
  REI, and The North Face run Akamai/WAF bot management that blocks by datacenter IP.** Vercel's
  serverless functions run on datacenter IPs, so the origin returns a **200 bot-failover/challenge
  page** (Patagonia: an Akamai ESI "Hang Tight…" page), a **403** (TNF), or a **refused connection**
  (REI). No server-side header tweak changes this — it is an IP-reputation block.
- We confirmed empirically: a residential-proxy + anti-bot service (Scrapfly, `asp=true`) **clears
  REI and The North Face** (real product HTML, JSON-LD extracted end-to-end through our own parser),
  but **does NOT clear Patagonia** even with residential + browser + retry. Because residential *is*
  the premium tier, a paid plan would not fix Patagonia either — its config is simply too hard.

The honest no-signal guard (the page parsed but carried no product data ⇒ `{ ok:false }`, no junk
draft) was already added. This ADR adds the capability to actually *get past* the walls we can.

## Decision

Add an **optional residential-proxy fallback** behind a server-only `SCRAPFLY_KEY`, wired as a
**second attempt only when the direct fetch yields no product signal**:

1. `src/server/scrapfly-fetcher.ts` — `fetchViaScrapfly(url)` returns the **same `FetchResult`** shape
   as the direct fetcher. It re-runs the core **shape gate** (`validateEnrichUrl` + the allowlist) so
   only an allowlisted manufacturer URL is ever handed to the third party, then calls Scrapfly's scrape
   API with `asp=true&render_js=true&proxy_pool=public_residential_pool&country=us` and unwraps
   `result.content`. Never throws; a Scrapfly-level failure is a `{ ok:false, reason:"scrapfly: …" }`.
2. `enrichFromUrlToDraft` is now **direct-first**: it fetches directly (free, fast), and only if that
   produced no signal — and the URL was not shape-rejected, and Scrapfly is configured — does it retry
   through `fetchViaScrapfly`. Non-walled brands (Marmot, Arc'teryx, Black Diamond) never spend a
   credit; each item is fetched once and cached in `item_evidence`, so usage is a trickle.
3. **Graceful + hermetic:** with no `SCRAPFLY_KEY` (the gate, dev, and any deploy that doesn't set it),
   the fallback is never taken and behavior is byte-for-byte today's. The fallback is injectable
   (`EnrichDeps.fetchScrapfly`) so the orchestration is tested without the network.

### Why Scrapfly (vs ScraperAPI / ZenRows / Bright Data)

Compared on free tier, Akamai success, and integration fit. **ScraperAPI's free/trial tier gates the
residential pool behind a paid plan** (verified: its free datacenter pool returns the same bot-failover),
so it cannot bypass these walls for free. **Scrapfly's free tier includes `asp` + residential
auto-upgrade and does not bill failed bypasses** — verified working on REI/TNF. ZenRows has no recurring
free tier; Bright Data is pay-as-you-go with no real free tier. Scrapfly returns the page HTML directly
(unwrapped from one JSON field), so it drops into the existing parser unchanged.

## Consequences

- **Unlocks REI + The North Face** URL enrichment (previously 100% blocked). Marmot/Arc'teryx/Black
  Diamond keep working via the free direct path.
- **Patagonia stays add-by-name** — documented and honest; not fixable by paying. The no-signal guard
  gives the user a clear "add by name" message rather than a junk draft.
- **New external dependency** (gated per the repo's ask-first rule; the user approved). Server-only
  secret `SCRAPFLY_KEY` must be set in Vercel + `.env.local`; never `NEXT_PUBLIC_`. The endpoint URL
  carries the key — it must never be logged.
- **Egress:** the call is plain HTTPS to `api.scrapfly.io`, which the sandbox/Vercel can reach (unlike
  raw Postgres) — verified live from the sandbox.

## Alternatives considered

- **Direct fetch only** — leaves REI/TNF permanently blocked. Rejected; the fallback is opt-in and free.
- **Headless browser on Vercel (Playwright)** — still a datacenter IP (Akamai blocks it) + heavy cold
  starts. Rejected.
- **Always route through Scrapfly** — burns credits on brands that work for free. Rejected in favor of
  direct-first / fallback-on-no-signal.
- **Pay ScraperAPI ($49/mo)** — its residential tier might match Scrapfly, but Scrapfly's free tier
  already delivers; no reason to pay. (And neither cracks Patagonia.)
