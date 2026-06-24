# ADR-0011 — Manufacturer URL enrichment: SSRF-gated fetch, JSON-LD+OG parsing, provenance overlay

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 3 step 2

---

## Context

Phase 3 step 1 (real auth + multi-user) is in delivery. Step 2 is manufacturer URL enrichment —
the highest-value item-input improvement after name-based classification.

The current classification pipeline accepts a product name, calls the LLM, and emits
`source:"inferred"` or `source:"llm"` facts. These facts are confidence-graded but are still
inferences: the LLM reasons from its training data about what a product is likely to be. For hard
facts — fill power, composition percentage, UPF rating, EN temperature standard, crampon
compatibility — inference is structurally disallowed by the mechanical demotion guard (ADR-0004:
a hard fact returned with a non-stated source is silently rewritten to `{value:null, source:"unknown"}`).
That means those fields stay null until the user manually corrects them.

Manufacturer product pages carry authoritative specs. A user who already has a tab open showing the
product they are adding can paste the URL; the server fetches the page and extracts the stated specs.
Those specs enter the system as `source:"manufacturer"` — the top of the provenance hierarchy
(above `source:"inferred"` and `source:"llm"`; below only `source:"user"`). For the first time, the
demotion guard's "stated" precondition is satisfiable without the user manually entering every field.

Two technical risks require careful design:

1. **SSRF (Server-Side Request Forgery).** A server-side HTTP fetch controlled by user-supplied URLs
   is a canonical SSRF vector: an attacker can supply an internal hostname or IP to probe the host's
   private network, exfiltrate metadata endpoint content (e.g. AWS IMDS at 169.254.169.254), or
   cause DNS rebinding. This risk is mandatory to address before shipping any user-controlled fetch.

2. **Parsing reliability vs dependency.** Manufacturer pages vary in structure. A full HTML/DOM
   parser (cheerio, node-html-parser) provides the most reliable extraction but introduces a new
   dependency. Schema.org `Product` JSON-LD (a `<script type="application/ld+json">` tag) and
   OpenGraph/meta tags are structured-data standards explicitly designed for machine extraction; they
   are present on the vast majority of outdoor-gear manufacturer pages and can be extracted with
   defensive regex and `JSON.parse` — no parser library required.

3. **Provenance layering.** The existing `Source` union
   (`'manufacturer' | 'user' | 'inferred' | 'derived_from_material' | 'unknown'`) already
   encodes the hierarchy. The enrichment output must be a **partial overlay** — it writes only facts
   that are stated on the page, leaving all other fields at their existing values. A manufacturer
   assertion replaces an inferred value; a user correction still outranks manufacturer.

4. **The architecture purity invariant (CLAUDE.md rule #3).** `src/core/` is framework-agnostic:
   no `next/*`, no React, no DB singletons, no fetch. The URL-shape validation and page parsing logic
   must live in `src/core/enrich/` (pure, testable, injectable). The network fetch and the
   DNS/private-IP resolver check must live in `src/server/` and be injected into core as a
   dependency. The UI entry point lives in `src/app/`.

5. **Bridge to the material behavior library.** Composition percentage extracted from a manufacturer
   page (`source:"manufacturer"`) is the highest-confidence input the material behavior derivation
   engine could receive. When that engine is built — deriving behavioral facets (breathability, dry
   speed, warmth-when-wet retention) from authoritative material composition + construction type —
   it will read `source:"manufacturer"` composition facts as its primary signal. URL enrichment is
   therefore not only a quality improvement for individual items; it supplies the ingredient the
   next initiative (composition → derived facets, `source:"derived_from_material"`) needs to work well.

---

## Decision

### A — Parse strategy: JSON-LD + OpenGraph/meta; no new parser dependency in v1

**Decision:** extract structured data exclusively from:

1. **Schema.org `Product` JSON-LD** — `<script type="application/ld+json">` block(s) containing
   a `@type: "Product"` (or `@graph` array including one). Fields of interest: `name`, `brand`,
   `description`, `weight`, `material`, `color`, `offers` (for `price`), and any domain-specific
   extensions manufacturers include.

2. **OpenGraph and HTML meta tags** — `<meta property="og:*">` and standard `<meta name="*">` tags.
   Useful for product name, description, and image; weaker for specs but a reliable fallback.

Extraction uses defensive regex to locate the JSON-LD script block, then `JSON.parse` on the
content. A failed parse (invalid JSON) is silently discarded; extraction continues with the next
block. The result is a plain JS object; Zod validates the fields of interest before any value is
used. Anything that does not parse cleanly is treated as absent — no partial-parse guesses.

**A DOM/HTML-parser library (cheerio, node-html-parser) is explicitly deferred.** If JSON-LD+OG
coverage proves insufficient in production (assessed from Vercel logs after rollout), adding a
parser library is the next step — but it requires an explicit "ask first" decision per CLAUDE.md
before any new dependency lands. v1 ships without it.

### B — SSRF gate: mandatory, layered (URL-shape + DNS/IP block + network caps)

SSRF protection is non-negotiable and must be layered:

**Layer 1 — URL-shape gate (pure, in `src/core/enrich/`):**

- Protocol must be `https:` only. `http:`, `ftp:`, `file:`, `data:` and any other scheme are
  rejected before any network activity.
- The hostname must appear in the **manufacturer allowlist** — an exact domain match or a
  subdomain of an allowed domain (e.g. if `patagonia.com` is allowed, `www.patagonia.com` is
  allowed, but `evil-patagonia.com` is not). The allowlist is the primary enforcement boundary:
  a valid-shaped URL pointing at a non-listed host is rejected immediately.
- The URL must not contain credentials (`user:password@host`).
- The URL must not target a non-standard port. Port 443 (implicit for `https:`) is the only
  accepted port; an explicit port other than 443 is rejected.
- IP-literal hostnames are rejected regardless of the IP address. Only DNS names pass.

This layer runs entirely in `src/core/enrich/` with no I/O — it is a pure string predicate and
is trivially unit-testable without any network stub.

**Layer 2 — DNS/IP resolution check (server, in `src/server/`):**

After the URL passes the shape gate, the server resolves the hostname and checks every returned
IP address against the following blocked ranges before initiating the HTTP fetch:

- Loopback: `127.0.0.0/8`, `::1/128`
- Private RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local / APIPA: `169.254.0.0/16`, `fe80::/10`
- Multicast and reserved: `224.0.0.0/4`, `240.0.0.0/4`
- IPv6 unspecified: `::/128`

If any resolved IP falls in a blocked range, the fetch is aborted and the error is surfaced to
the caller. This check guards against DNS rebinding and against allowlist entries that may
themselves resolve to internal addresses.

**Layer 3 — Network fetch caps (server, in `src/server/`):**

- Maximum redirects: 3 (prevent open-redirect chains that escape the allowlist domain).
- Maximum response size: 2 MB (prevent resource exhaustion; product pages are well under this).
- Timeout: 10 seconds total (prevent slowloris/long-poll abuse).
- Redirect validation: each redirect target is re-checked against the URL-shape gate and the
  allowlist before following. A redirect to an off-allowlist domain is treated as a fetch failure,
  not an authorization bypass.

Both Layer 1 and Layer 2 are mandatory. Layer 1 (allowlist) is the primary defense; Layer 2 (DNS)
is defense-in-depth against allowlist entries with unexpected DNS resolution.

### C — Architecture split (enforces the purity invariant)

| What | Where | Why |
|------|-------|-----|
| URL-shape gate + allowlist logic | `src/core/enrich/url-gate.ts` | Pure predicate; no I/O; injectable; testable without network |
| JSON-LD + OG page parser | `src/core/enrich/parse-product-page.ts` | Pure function on a string (the page body); no fetch; testable with fixture HTML |
| Enrichment merger (overlay onto `ItemClassification`) | `src/core/enrich/merge.ts` | Pure: existing classification + extracted partial → merged classification |
| Network fetch + DNS/IP check (injected) | `src/server/enrich-fetcher.ts` | Network I/O + Node DNS; injected into core as an opaque `fetch(url): Promise<string>` |
| "Add/enrich by URL" UI and route handler | `src/app/items/enrich/` | Web surface; calls server action which wires fetcher into core |

Core (`src/core/enrich/`) receives the page body as a plain string — it never calls fetch or DNS
directly. The `src/server/enrich-fetcher.ts` module owns the SSRF-gated fetch and injects itself
as a `(url: string) => Promise<string>` callback. This mirrors the existing pattern for the
Anthropic client (injected) and the database (injected).

### D — Output: partial overlay, manufacturer outranks inference, user still outranks manufacturer

The parser output is typed as `Partial<ItemClassification>` — it asserts only the fields that are
explicitly stated on the page. Fields absent from the manufacturer page are absent from the overlay;
the merger does not write `null` for them.

Provenance precedence (highest to lowest):

| Priority | Source | Meaning |
|----------|--------|---------|
| 1 (highest) | `user` | User-stated or user-corrected — always authoritative |
| 2 | `manufacturer` | Stated on the manufacturer page (this feature) |
| 3 | `inferred` / `llm` | LLM-inferred from product name/description |
| 4 | `derived_from_material` | Derived from material composition (future engine) |
| 5 | `unknown` | Not determinable from any available source |

The merger (`src/core/enrich/merge.ts`) applies this precedence: a `manufacturer` fact replaces
an `inferred`/`llm`/`derived_from_material`/`unknown` value; it does not replace a `user` value.
The merged object is then passed through the existing Zod validation and demotion guard (ADR-0004)
before any persistence — there is no special path for manufacturer data.

### E — Testing reality: fixture-based in-sandbox, live verified on Vercel

The cloud sandbox cannot initiate outbound HTTPS connections to arbitrary manufacturer hosts
(per the engineering-log lesson: "the cloud sandbox cannot reach raw Postgres; expect the same
egress constraint for any raw-TCP service — test outbound HTTP calls against fixtures first, then
verify on Vercel"). Enrichment tests therefore use **fixture HTML files** (saved snapshots of
real manufacturer product pages) injected as the page-body string; no network is required.

The SSRF gate and the parser are both pure functions and are covered by unit tests that run
completely offline. Integration tests use fixture responses. Live end-to-end verification (paste a
real URL, confirm extracted specs appear in the review UI) is performed on Vercel after deployment.

### F — Allowlist seeding

The allowlist for v1 is a hardcoded array in `src/core/enrich/url-gate.ts`. Initial entries
cover the brands represented in the current seed corpus and a handful of major gear manufacturers:

```
patagonia.com, rei.com, arcteryx.com, thenorthface.com, marmot.com,
kelty.com, mountainhardwear.com, salomon.com, merrell.com, osprey.com,
blackdiamondequipment.com, petzl.com, nemo.com, thermarest.com
```

Additions require a code change (a deliberate friction point — not a runtime-configurable list —
so adding an allowlist entry is a reviewable, intentional act). Bulk allowlist management is a
future enhancement requiring its own decision.

---

## Alternatives considered

**Hosted scraping/extraction API (Diffbot, Scrapingbee, Firecrawl, etc.).** These services
return structured product data from any URL without requiring the server to perform its own fetch.
Rejected: introduces a new paid external service (new infra + ongoing cost), sends user-supplied
URLs to a third party (privacy consideration), and adds an `ask-first` dependency not yet
authorized. Deferred as a potential future upgrade if the self-hosted fetch+parse approach proves
insufficiently reliable at scale.

**Full DOM/HTML parser (cheerio, node-html-parser).** Provides reliable CSS-selector extraction
from arbitrary page structure; not dependent on schema.org compliance. Rejected for v1: adds a
new npm dependency (requires ask-first authorization per CLAUDE.md), and JSON-LD + OpenGraph cover
the majority of outdoor-gear manufacturer pages. Re-evaluate after rollout if coverage is
insufficient; the architecture (injected parser, pure `parse-product-page.ts`) makes the swap
entirely local to that module.

**Trust arbitrary user-supplied URLs (no SSRF gate).** Would expose the server to private-network
probing, metadata endpoint exfiltration, and DNS rebinding. Rejected outright. The layered SSRF
gate (URL-shape + DNS/IP + network caps) is mandatory, not optional.

**Allowlist as a runtime-configurable environment variable.** Would allow operators to add domains
without a code change. Rejected for v1: a code-change barrier is intentional — each addition is
a security decision that should be reviewed. A future admin-managed allowlist is possible but
requires its own design (schema, admin UI, audit log) and is deferred.

**LLM-based page extraction (send the raw HTML to the LLM).** The LLM could extract specs from
any page structure without regex or schema.org dependence. Rejected: large token consumption per
enrichment, high cost and latency, and the LLM is capable of fabricating values it does not find
(the canonical anti-pattern, ADR-0004). Structured-data extraction (JSON-LD + OG) is deterministic:
if a field is absent, it is absent.

**Parsing in the client (browser fetch + JS extraction).** Avoids SSRF entirely (the browser is
not the server). Rejected: CORS blocks cross-origin fetches from the browser to manufacturer pages;
would require a CORS proxy (same SSRF risk, different layer) or a browser extension (out of scope).

---

## Consequences

### What is better

- Hard facts (fill power, composition, UPF, crampon compatibility, EN standard) can now be
  populated as `source:"manufacturer"` without requiring the user to type them manually.
- The mechanical demotion guard's `stated` precondition is satisfiable without user input — the
  most significant quality improvement to the classification pipeline since Phase 1.
- `source:"manufacturer"` composition data is the highest-quality input available to the material
  behavior derivation engine (the next initiative). Enrichment today directly enables better
  derivation later.
- The SSRF gate is in `src/core/` (pure, testable) and is the same module that any future
  barcode/photo/feed enrichment would reuse — the gate is built once.

### Architecture invariants preserved

- No new npm dependency in v1. The parser is regex + `JSON.parse`.
- The purity invariant is maintained: `src/core/enrich/` has no I/O; the network fetch lives in
  `src/server/`.
- The Zod classification contract and the demotion guard (ADR-0004) apply unchanged to
  manufacturer-sourced data — there is no special-casing.
- The allowlist is code, not config — additions require a pull request.

### Known limitations / future work

- **Coverage.** JSON-LD + OG extraction works best on pages that implement schema.org properly.
  Pages that render product specs only via JavaScript (SPA/CSR with no server-side HTML) will
  yield little or no data. Post-rollout coverage assessment will determine whether a DOM parser or
  a headless-browser fetch is warranted (each requires an `ask-first` decision).
- **Allowlist breadth.** The initial allowlist covers a curated set; users with gear from unlisted
  brands will receive a "URL not on the supported list" error. Allowlist expansion is the expected
  first operational request after launch.
- **Redirect validation.** Redirect chains are capped at 3 and each redirect target is re-checked
  against the allowlist; however, very long affiliate/redirect chains common on retailer links may
  fail. The UI should surface a clear error so the user can supply the direct manufacturer URL.
- **Testing environment.** All enrichment tests are fixture-based (offline). Live verification is
  done on Vercel. The in-sandbox gauntlet remains hermetic and secret-free.
- **Bridge to material derivation engine.** The derivation engine (composition → behavioral facets,
  `source:"derived_from_material"`) is the designed-for next initiative after URL enrichment. It
  is not built as part of this step; URL enrichment supplies the ingredient it will consume.
