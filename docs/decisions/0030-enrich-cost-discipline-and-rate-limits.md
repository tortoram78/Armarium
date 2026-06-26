# ADR-0030 — Enrichment cost discipline + rate-limit budgeting

**Status:** Accepted
**Date:** 2026-06-26
**Refines:** ADR-0028 (enrich-by-name). Context: the rate-limiter itself already exists, wired, and
tested (ADR-0017 ops-hardening); this ADR fixes a cost mismatch that ADR-0028 introduced and records the
scale gap.

---

## Context

The in-process token-bucket rate limiter (`src/core/ratelimit.ts` + `src/server/ratelimit-guard.ts`) is
already wired across the cost-bearing server actions with per-op budgets (`classify ~10/min`,
`parse ~10/min`, `enrich ~5/min` (outbound network, tighter), `weather ~15/min`), keyed per-user / per-IP.

ADR-0028 made `enrichItem` (the by-name path) fire a **web-search call** (an outbound, billable
`web_search` loop). But `enrichItem` is invoked by TWO actions:
- `classifyNowAction` — the **explicit** "Auto-fill from name" button (high user intent), and
- `enrichItemAction` — the **automatic** post-capture / batch enrichment fired by the browser per item.

As written, BOTH did the web search, and both spent the looser `classify` budget. A paste-a-list of 200
items would auto-fire 200 web searches on the `classify` budget — a cost bomb at scale.

## Decision

**Web search is opt-in, on the explicit single-item path only:**
- `enrichItem(id, userId, deps, { webSearch: true })` runs the web-search overlay; without the flag (and
  without an injected `deps.webSearch`), it is **inference-only** (cheap).
- `classifyNowAction` ("Auto-fill from name") passes `{ webSearch: true }` AND spends the tighter
  **`enrich`** budget (it makes an outbound call), not `classify`.
- `enrichItemAction` (automatic batch / quick-add follow-up) passes **no** web search and keeps the
  `classify` budget — so bulk capture stays fast and cheap; items get inference now, and the user can
  press "Auto-fill from name" on the specific items they care about.

## Consequences
- **Cost is bounded by intent:** expensive web search happens only when a user explicitly asks for it,
  metered on the network-tier budget. Bulk capture cannot stampede the web-search/API spend.
- Tests green (666); the existing rate-limit suites (`ratelimit`, `ratelimit-guard`,
  `actions.ratelimit`) and `enrich-by-name` (injects `deps.webSearch`, so unaffected) all pass.

## Known scale gap (NOT closed here — needs a decision)
The limiter is **per-serverless-instance, in-memory** (its own header says so): on multi-instance Vercel
the budget is per-instance, so a determined caller hitting different warm instances can exceed it, and a
cold start resets buckets. This is a fine **abuse brake** but NOT a billing-grade global ceiling. For the
10k–100k+ user target, a **shared-store limiter** is required. Recommended: a **Postgres-backed** atomic
token bucket (no new infrastructure — Postgres is already in the stack), selected when `DATABASE_URL` is
set and falling back to the in-memory limiter otherwise (keeps the hermetic gate). A hosted limiter
(Upstash/Redis) would be faster but is new infra (ask-first). **Deferred pending that decision.**
