# ADR-0013 — Cache split: `llm_draft_cache` (global) + `user_overrides` (per-user)

**Status:** Accepted
**Date:** 2026-06-24
**Phase:** Phase 2 (evidence-architecture) — concrete implementation of ADR-0012 Element 5

---

## Context

ADR-0012 Element 5 set the architectural target: replace the single shared `classification_cache`
table with three distinct stores (`llm_draft_cache`, `user_overrides`, `canonical_facts`), deferring
`canonical_facts` until the canonical products table (Element 1) is built (Phase 4). This ADR records
the **concrete implementation decisions** for that split, now being built.

### The problem being solved

The self-building classification cache (ADR-0007) was designed as a global shared knowledge base.
That design carried an explicit known trade-off, documented in ADR-0007 Consequences:

> The `source` field encodes a clear provenance hierarchy: `"user"` beats `"llm"` beats `"seed"`;
> no automatic override goes the other direction.

The trade-off was tolerable in Phase 2 because there was effectively one user (a one-password gate,
`ARMARIUM_USER_ID`, no real auth). Phase 3 step 1 (ADR-0008) delivered real multi-user: Supabase
Auth, `auth.uid()`, RLS. The trade-off is now a **concrete security and data-quality risk**:

- **Cross-tenant correction leakage.** A `source:"user"` correction by User A to "Patagonia
  Nano-Air Hoody" is written to the global `classification_cache`. User B's next add of an
  identically-named item — potentially a different model year, different fill power — receives
  User A's correction as if it were authoritative. One user can silently corrupt another user's
  classifications without either being aware of it.

- **No data-subject isolation.** Under GDPR, a user's personally-contributed corrections (their
  preferences, their knowledge of their own gear) must be inspectable and deletable per-user.
  A shared global table cannot satisfy this without scanning the full table for indirect
  attribution.

The security audit conducted as part of Phase 3 step 1 (ADR-0008) identified this cross-tenant
leakage as a real concern to be resolved. ADR-0012 Element 5 provided the resolution path; this
ADR records the concrete choices.

### What is not broken

The `source:"llm"` and `source:"seed"` rows in the existing cache are low-authority drafts. Sharing
them across tenants is **desirable**: they save LLM calls, and the review-before-save step (the
safety valve established by ADR-0007) catches any mismatch between the draft and the user's actual
item. The problem is exclusively with `source:"user"` rows — corrections that carry false
cross-tenant authority.

---

## Decision

### Two tables replacing `classification_cache`

#### 1. `llm_draft_cache` — global, no `user_id`

- **Scope:** global. No `user_id` column. Service-role access only (same as current
  `classification_cache` RLS posture per ADR-0007 and ADR-0008).
- **Contents:** LLM-emitted classifications as **low-authority drafts**, plus seed corpus entries.
  Corresponds to current `source:"llm"` and `source:"seed"` rows.
- **Key:** `normalizeCacheKey(name)` — unchanged from the current cache.
- **Semantics:** a hit here provides a **starting draft** for the review step. Review still gates
  saving. A draft hit is not authoritative; it is a shortcut that avoids a redundant LLM call.
- **Authority label:** `draft` (replacing the `source` field values `"llm"` and `"seed"`).

#### 2. `user_overrides` — per-user, `user_id` NOT NULL

- **Scope:** per-user. `user_id` NOT NULL, foreign key to the auth user. Primary key is the
  composite `(user_id, key)` — a user's correction to a name is scoped to that user only.
- **Contents:** a user's confirmed or explicitly corrected classifications for their named items.
  Corresponds to current `source:"user"` rows, but now correctly scoped.
- **Key:** `normalizeCacheKey(name)`, same normalization as the draft cache.
- **RLS:** owner-only policies: `(select auth.uid()) = user_id` on SELECT, INSERT, UPDATE, DELETE.
  This is the ADR-0008 / `drizzle/0003` RLS pattern applied to the override store. The service-role
  connection (used by server-side Drizzle) bypasses RLS and uses the app-layer `user_id` filter
  directly, consistent with the dual-layer enforcement model (ADR-0008).
- **Authority label:** `user`.

#### 3. `canonical_facts` — deferred to Phase 4

`canonical_facts` (global, linked to `canonical_products`) requires the canonical products table
(ADR-0012 Element 1) to be built first. That table is Phase 4 of the evidence-architecture
migration sequence. It is **not built in this phase** and is not referenced in the lookup path
below. The two-table split (draft cache + user overrides) is complete and correct without it.

### Lookup precedence

The resolver consults the two active stores in this order:

```
1. user_overrides(userId, key)   — authority: "user"   → if found, use this; done
2. llm_draft_cache(key)          — authority: "draft"  → if found, use as starting draft
3. (miss)                        → call LLM; write result to llm_draft_cache
```

This mirrors the resolver's explicit precedence table from ADR-0012 Element 3
(`user > inferred/llm`): the user's own scoped correction is always the highest authority,
falling through to the shared low-authority draft, falling through to a live LLM call on a
complete miss.

A `user_overrides` hit produces a result with `authority: "user"` and `fromCache: true`. A
`llm_draft_cache` hit produces `authority: "draft"` and `fromCache: true`. The calling code
may surface this distinction in the review UI, though review is required regardless of which
table was hit.

### Migration of existing rows

All existing rows in `classification_cache` — regardless of their current `source` value — are
migrated to `llm_draft_cache` as **drafts**.

This is the load-bearing choice, and it is explicit:

- Existing `source:"llm"` and `source:"seed"` rows migrate straightforwardly: they were always
  low-authority drafts.
- Existing `source:"user"` rows also migrate to `llm_draft_cache` as drafts. **We do not attempt
  to attribute them to a specific user.**

Rationale: the existing `source:"user"` rows were written to a global table with no `user_id`.
We cannot know which real user wrote each row. The options are:

1. Migrate to `llm_draft_cache` as drafts (this decision).
2. Attribute to `DEFAULT_USER_ID` (the Phase 2 dev passthrough user, not a real identity).
3. Delete them.

Option 2 is rejected (see Alternatives). Option 3 is rejected because it discards accumulated
classifications, increasing LLM call volume and non-determinism for previously-seen items.
Option 1 preserves availability without fabricating attribution. These rows were already being
used as if they were drafts (review-before-save always applied); downgrading their `source` label
to `draft` correctly describes their actual authority level in a multi-user system.

A user who had previously corrected an item will see the old global classification as a draft on
their next add of that name, then re-correct through the normal review flow. Their correction will
write to `user_overrides(userId, key)` and will correctly scope to only them going forward.

After migration is confirmed, `classification_cache` is dropped.

### Write paths after migration

- **Cache miss → LLM classifies:** result written to `llm_draft_cache(key)` as `authority: "draft"`.
- **User confirms draft (no corrections):** classification upserted to `user_overrides(userId, key)`
  as `authority: "user"`.
- **User corrects a facet:** corrected classification upserted to `user_overrides(userId, key)`
  as `authority: "user"`.

---

## Alternatives rejected

### Keep one shared `classification_cache` table

The status quo. Rejected because `source:"user"` rows carry false cross-tenant authority in a
real multi-user system (ADR-0008 delivered real auth). The risk is not theoretical: two users
with items sharing the same normalized name would exchange corrections silently. The ADR-0007
trade-off was acceptable for a single-user system; it is not acceptable with `auth.uid()` and RLS.

### Attribute existing `source:"user"` rows to `DEFAULT_USER_ID`

`DEFAULT_USER_ID` is the constant used by the Phase 2 dev/passthrough path when Supabase Auth
is not configured (ADR-0008 §dev fallback). It is not a real user identity — it is a placeholder
for a development environment or an unauthenticated session. Attributing historical corrections
to this ID would:

- Associate real user corrections with a dev placeholder, polluting that user's `user_overrides`
  with data from unknown actual users.
- Create a fake user record in `user_overrides` that does not correspond to any real auth.uid().
- Potentially surface these ghost corrections to any future session that receives `DEFAULT_USER_ID`
  (e.g. a dev environment), causing unexpected behavior.

Rejected. The correct interpretation of "we don't know who wrote this row" is `authority: "draft"`,
not a fabricated attribution.

### Per-user copies of all draft entries

Eagerly copy every `llm_draft_cache` entry into `user_overrides` for each user on their first
lookup. This would give each user an isolated copy of the draft corpus from which their personal
corrections diverge. Rejected because:

- Storage cost grows as O(users × cache size). For a shared low-authority draft this is wasteful.
- The draft cache's entire purpose is amortizing LLM calls across users. Copying it per-user
  eliminates that benefit.
- The review-before-save safety valve already isolates per-user outcomes at the point of
  confirmation: the shared draft is a starting point, not a committed value. No isolation is
  needed before the user has reviewed and confirmed.

---

## Consequences

### Security: cross-tenant correction leakage is resolved

This ADR directly resolves the open trade-off documented in ADR-0007 Consequences. A user's
correction to a named item no longer propagates to other users' classifications. Each user's
`user_overrides` rows are invisible to other users through both RLS (on the PostgREST surface)
and app-layer `user_id` filtering (on the Drizzle owner-role path).

ADR-0007 is **not superseded**; its design and cache mechanics remain in force. Its known
cross-tenant trade-off is **resolved** by this ADR.

### Data-subject rights: per-user entries are inspectable and deletable

`user_overrides` rows are owned by `user_id`. Deleting a user's account can cascade-delete their
override rows, satisfying the GDPR right to erasure without touching the global draft cache. A
user's personal corrections can be listed and exported without scanning all users' data.

### Draft sharing preserved: LLM calls are still amortized

`llm_draft_cache` remains global. A draft classification for "Arc'teryx Beta AR" computed for
User A is available as a starting point for User B. The amortization benefit of a shared draft
store is preserved. The authority label (`draft`) ensures no downstream code can treat a shared
draft as a user-endorsed correction.

### Review step remains mandatory

A `user_overrides` hit does not bypass review. The review-before-save lifecycle (ADR-0007;
ADR-0006 §draft lifecycle) applies to all paths. The cache split changes authority scoping,
not the review gate.

### Migration window: existing `source:"user"` rows lose their elevated status

Users who previously confirmed or corrected items under the single-user Phase 2 setup will see
their items' cached classifications presented as drafts (not as their own prior corrections) on
their first post-migration add of those names. They can re-confirm or re-correct through the
normal review flow. This is a one-time re-review cost, bounded by the number of previously-seen
item names per user.

### Relationship to ADR-0012 migration sequence

This ADR implements **Migration Phase 2** of the ADR-0012 evidence-architecture sequence:

```
Phase 1 — Resolver keystone (done)
Phase 2 — Cache split (this ADR)           ← implemented here
Phase 3 — Evidence store + claims LLM (future)
Phase 4 — Canonical products (future; prerequisite for canonical_facts)
```

`canonical_facts` is not built here; it is explicitly deferred to Phase 4 and is a designed-for
component, not a built one.
