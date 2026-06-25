# ADR-0022 — Decouple ownership from classification: record-only capture + async enrichment

**Status:** Accepted
**Date:** 2026-06-25
**Phase:** Closet-database Phase 1 (possession-model inversion)

---

## Context

Every path that creates an `items` row today — whether from `addItem(name)`, from the
name-only fallback, or from URL enrichment — is gated behind the classification pipeline:
the item does not exist in the database until the LLM call returns, Zod validates the output,
and the evidence resolver completes. This produces two concrete problems:

1. **Ownership is a classification byproduct.** The user's act of recording "I own this
   jacket" is blocked on an LLM round-trip (~2–5 s, potentially longer if enrichment tiers
   run). If the LLM errors, the item is never persisted. If the item name is not in the
   classification corpus, the current name path throws rather than degrading gracefully.
   The act of recording ownership should be near-instant and must not depend on a
   network service.

2. **Non-gear items are hard-blocked.** A user who wants to record a camera, a board game,
   or any non-outdoor-gear possession has no path at all — the classification pipeline
   assumes gear and produces nonsense or throws for items with no gear facets. As Armarium
   expands to a general-purpose personal inventory (see ADR-0023), blocking item creation on
   classification is not viable.

The enrichment pipeline — name-based LLM classification, URL-tier manufacturer extraction
(ADR-0011 / ADR-0019 / ADR-0020), and the evidence resolver (ADR-0012) — is the strongest
differentiator in the product. The goal is not to remove it; the goal is to make it a
non-blocking, background follow-up rather than a prerequisite for the existence of the item.

---

## Decision

### The inversion: record first, enrich asynchronously

A new code path `recordOwnership(name, inventoryDefaults?)` in `src/core/` (and its server
action counterpart) does the following in a single fast transaction:

1. Construct `unknownBehavioralClassification(name)` — the existing all-unknown classification
   envelope with every facet set to `{ value: null, confidence: 'unknown', source: 'unknown' }`.
2. Set `ownership_status = 'owned'` (or the caller-supplied status), `DEFAULT_INVENTORY`
   (quantity = 1, all other inventory fields null unless the user supplied them).
3. Persist the item. The row is now live in the database. The user sees it immediately in
   their closet.
4. Enqueue enrichment as a background job: the existing classify → URL-tier → evidence-resolver
   pipeline runs after the response is returned to the user. The item's classification columns
   are updated in place when enrichment completes. The UI reflects the improvement without
   requiring the user to wait for it.

**Capture latency target: under 1 second** from the user submitting a name to seeing the item
in their closet.

### Classification stays NOT NULL via the all-unknown envelope

Making `classification` nullable was considered (see Alternatives below) and explicitly rejected.
The all-unknown envelope is a valid, well-formed classification: it passes the Zod schema, it
correctly produces `blocked_unknown` on every capability gate (so the item shows as
"unverified" in trip planning rather than crashing), and it requires no change to any downstream
reader. The contract established in ADR-0004 is preserved intact.

### Degrade-not-throw on non-corpus items

The name-based classifier currently throws when it cannot find a recognizable product in its
training data. This behavior is incompatible with a general-purpose inventory: most cameras,
board games, and household items are not in the gear corpus, and a throw means the item
cannot be recorded at all.

The fix: the LLM classification path degrades to `unknownBehavioralClassification(name)` on
any error, including corpus-miss. Enrichment failure is never a hard failure for item creation.
The item exists with all facets unknown; the user can correct facets manually; background
enrichment retries may later improve the classification. Unknown is first-class (ADR-0004).

### Enrichment remains the strong default

Decoupling does not demote enrichment — it re-sequences it. The same tiers (name classify →
direct URL fetch → Scrapfly residential fallback → web-search → all-unknown floor) run in the
background for every item where they are applicable. For gear items from known brands, the
enrichment result typically arrives within seconds of the item appearing in the closet. The
UX difference from the user's perspective is that the closet card appears immediately at
confidence `unknown` and upgrades in place rather than making the user wait at a loading screen.

For non-gear domains, enrichment currently produces all-unknown (domain-specific classifiers are
fast-follows per ADR-0023) but the item is still recorded and usable as an inventory record.

### Trip engine reads quantity, status, and condition for free

Once `ownership_status`, `quantity`, and `condition` are typed columns (ADR-0021), the
recommendation engine can filter to `owned` items, surface multiple units (e.g. "you own 2
of these"), and use `condition = 'end_of_life'` as a signal to treat an item as a gap
candidate even when it exists in the closet. No new capability definitions are required —
the recommendation engine reads these columns as inputs to existing queries.

---

## Alternatives considered

**Classify first, then apply lifecycle states (current behavior, extended).** Keep the
synchronous classification gate; add ownership-status as a post-classification transition.
This preserves the existing add-item flow but does not solve the core problem: the user still
waits on LLM latency before the item exists, a classification error still blocks item creation,
and non-gear items are still impossible to record unless the classifier degrades gracefully.
The right fix is degrade-not-throw either way; once that is in place, there is no reason to
keep the synchronous gate. Rejected.

**Make classification fully opt-in (no enrichment by default).** The user explicitly requests
enrichment after recording an item. This solves the latency problem but abandons the product's
strongest differentiator — automatic, evidence-graded behavioral facets — for users who forget
or do not know to trigger it. The all-unknown floor is then the typical state rather than the
transient state. The moat (facet-graded capability reasoning, gap detection, evidence resolver)
only functions on enriched items; making enrichment opt-in makes the moat opt-in.
A large fraction of items would remain all-unknown permanently. Rejected.

**Two separate item types (possession record vs classified item).** A `possessions` table
alongside `items`, with a promotion path. Cleaner separation in the schema, but introduces a
join in every downstream reader, a UI that must explain the distinction, and a promotion step
that is easy to defer indefinitely. The all-unknown envelope achieves the same separation
semantically — a record-only item is just an item that has not been enriched yet — without the
schema complexity. Rejected.

---

## Consequences

### What is better

- Recording ownership is instant and cannot fail due to a classification error or LLM timeout.
- Non-gear items can be recorded immediately; enrichment for non-gear domains follows when those
  domain classifiers are built (ADR-0023).
- The trip engine gains `quantity`, `status`, and `condition` as first-class inputs at no
  additional cost; no capability predicate changes.
- The degrade-not-throw posture makes the entire add-item surface more resilient: a corpus miss,
  LLM 5xx, or timeout are now soft failures rather than user-visible errors.

### Architecture invariants preserved

- The evidence contract (ADR-0004), Zod validation, and the hard-fact demotion guard are
  unchanged. Background enrichment produces the same validated output as synchronous enrichment.
- `classification` remains NOT NULL on every row in the database.
- Unknown-is-first-class: a record-only item has all facets unknown, which correctly produces
  `blocked_unknown` on every capability gate. It never silently satisfies a capability.
- The core purity invariant (CLAUDE.md rule #3): `recordOwnership` in `src/core/` has no I/O;
  persistence and job enqueueing live in `src/server/`.

### Known limitations / deferred

- **Background job infrastructure.** Phase 1 may implement async enrichment via a simple
  server-action follow-up (fire after the record response is sent) or a lightweight queue.
  A durable job queue with retry (e.g. Supabase Edge Functions, Vercel Cron, pg-boss) is
  designed-for but not specified here; the choice requires an `ask-first` infra decision before
  implementation. The semantics — enrich in the background, update in place, never block creation
  — are fixed regardless of the queue mechanism chosen.
- **Enrichment status indicator.** The closet UI should distinguish items that are `pending_enrich`
  from items that are fully classified or confirmed-unknown. The status column or a lightweight
  `enrich_state` flag (pending / done / skipped) is a Phase 1 UI concern, not modelled here.
