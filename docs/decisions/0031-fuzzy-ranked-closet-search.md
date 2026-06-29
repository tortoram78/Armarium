# ADR-0031 — Fuzzy, ranked, multi-field closet search

**Status:** Accepted (owner: "better … search" — closet-first pivot, workstream C)
**Date:** 2026-06-26

---

## Context

Closet search was a single-pattern, case-insensitive **substring** match over name/brand/model
(`itemMatchesSearch` → `ILIKE '%term%'`). No typo tolerance, no word-order independence, no tag match,
no relevance ranking — "patagona" found nothing, "atmos osprey" missed "Osprey Atmos", and results came
back in time order regardless of how well they matched.

## Decision

A single pure-core scorer, `searchScore(fields, query) → number` (`src/core/inventory.ts`), is now the
source of truth for closet search relevance. It combines two signals (higher wins):
- **Whole-phrase hit** in one field (exact > prefix > substring), weighted by field (name > brand >
  model > tag).
- **Token coverage** across ALL fields: every query token must match some field token — exact, prefix,
  substring, or **fuzzy** (Dice-coefficient over character **trigrams**, the same primitive Postgres
  `pg_trgm` uses). A query token that matches nothing zeroes the token signal, so unrelated queries
  score 0. Matching spans **name/brand/model/user-tags** and is word-order independent.

`itemMatchesSearch` is now `searchScore > 0` (typo-tolerant + tag-aware), preserving its boolean callers.

**In-memory repo** ranks results by `searchScore` desc (newest as tiebreak) when a query is present, and
paginates by offset in that mode (keyset cursors are for time order). Tags are included in the searched
fields. Fully covered by `test/search-score.test.ts` (typo tolerance, word-order, cross-field, ranking,
no-false-match) — 673 tests green.

**Postgres repo** is upgraded to **token-aware** multi-field ILIKE (every whitespace token must hit
name/brand/model), so word-order and multi-token queries work without a migration. Ordering/pagination
are unchanged.

## Consequences
- **Better for the user:** typos, partial words, any order, and tag matches all find gear, best-match
  first (in-memory/dev/guest, fully verified).
- **Honest verification boundary:** the in-memory path is tested and exact. The Postgres path gains
  token-aware matching now; **full trigram typo-tolerant RANKING (to mirror `searchScore` exactly) is a
  flagged follow-up** — it needs a migration (`CREATE EXTENSION pg_trgm` + GIN trigram indexes on
  name/brand/model) and an `ORDER BY GREATEST(similarity(...))` rework of the keyset/offset pagination,
  which cannot be verified in the no-DB sandbox (engineering-log lesson: the sandbox can't reach raw
  Postgres). It will be built + applied + verified on a DB-connected env / deploy.
- **No new dependency:** the fuzzy primitive is a dependency-free trigram Dice coefficient in core; the
  DB follow-up uses Postgres-native `pg_trgm` (already available on Supabase), no new infra.
