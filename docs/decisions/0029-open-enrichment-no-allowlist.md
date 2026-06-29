# ADR-0029 — Open enrichment: remove the domain hardcap

**Status:** Accepted (owner decision 2026-06-26: "let's just remove the 6-domain hardcap")
**Date:** 2026-06-26
**Supersedes:** ADR-0028 §A (the allowlist *expansion*). ADR-0028 §B (web-search wired into the by-name
path) stands.

---

## Context

ADR-0028 widened the manufacturer allowlist 6 → ~40 hosts. The owner's call: a curated list of any size
is still a hardcap — it will always miss brands, and that gating is exactly what made "the fetch doesn't
work." Lift it entirely so enrichment covers **any** brand / product page.

The allowlist (`MANUFACTURER_ALLOWLIST`) was doing **two different jobs**, only one of which is a real
security control:

1. **Web-search citation/authority filter** (`extractViaWebSearch`: `allowed_domains` + the citation
   gate). **No SSRF surface** — Claude's server-side `web_search` tool does the fetching, not ours. The
   allowlist here only narrowed *which* sites could be cited.
2. **Direct-fetch SSRF shape gate** (`validateEnrichUrl`, used by `fetchManufacturerHtml`). Here a host
   restriction is defense-in-depth — but it was never the *primary* SSRF control. The primary control is
   the runtime **IP-guard** (`ip-guard.ts`): resolve every host to all A/AAAA addresses and block any
   private/loopback/link-local/reserved IP, re-validated on every redirect hop.

## Decision

Run the live enrichment paths in **OPEN MODE** — an empty allowlist (`allowlist: []`) — while keeping
every non-host defense:

- `validateEnrichUrl`: an empty allowlist skips ONLY the host-membership check. https-only,
  no-credentials, no-explicit-port, and no-IP-literal shape checks all still apply. A non-empty allowlist
  is still enforced exactly as before (the conservative default + the gate's unit tests are unchanged).
- `extractViaWebSearch`: when the allowlist is empty, `allowed_domains` is **omitted** so search spans the
  whole web. The **citation gate stays**: the model's `source_url` must be a URL the search tool actually
  returned (anti-hallucination ground truth). So specs are never invented, restricted or not.
- Wiring: `getWebSearchEnricher()` (the by-name path) and `enrichFromUrlToDraft`'s direct fetch both pass
  `allowlist: []`. `MANUFACTURER_ALLOWLIST` remains as the conservative default for any caller that does
  not opt into open mode.

## Consequences

- **Better:** enrichment now resolves specs for **any** brand — the coverage the owner asked for; the
  direct cure for "the fetch doesn't work."
- **SSRF unchanged in substance:** the IP-guard still blocks every internal/reserved target at fetch time,
  re-validated per redirect hop; only the *host allowlist* (defense-in-depth) is lifted. This is the
  standard "allow any public host, block private IPs" SSRF posture. The TOCTOU caveat noted in
  `enrich-fetcher.ts` (pinned-IP dispatcher) is unchanged and still tracked.
- **Authority dilution (flagged, honest):** a spec is now cited to *any* real retrieved product page, not
  a vetted manufacturer/retailer. It is still **citation-gated** (tied to a real source, never
  hallucinated), but `toManufacturerEvidence` continues to tag it `source:"manufacturer"`. That tag now
  means "web-cited authoritative," not "vetted-manufacturer." A proper lower-authority `source:"web"` tier
  (distinct from curated manufacturer) remains the honest follow-up (deferred — it touches the evidence
  source model + demotion + display). Until then, the review-before-save step and per-item correction are
  the safety valve.
- **Tests:** `test/enrich-open-mode.test.ts` locks the contract — open mode permits any public https host
  yet still rejects http / credentials / IP-literal / port; a non-empty allowlist still rejects
  off-list + suffix-spoof hosts. 666 tests green; the 17 existing SSRF gate tests unchanged.

## Alternatives considered
- **Keep a (large) allowlist:** rejected by the owner — any finite list is a hardcap.
- **Introduce `source:"web"` lower-authority tier now:** the honest end-state, but a larger evidence-model
  change; deferred so the coverage win ships now. Tracked as follow-up.
