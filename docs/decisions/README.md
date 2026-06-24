# Architecture Decision Records (ADRs)

Each ADR captures one load-bearing decision so future contributors understand *why*, not just *what*.

**Format:** `NNNN-short-title.md`. Numbers are assigned once and never reused or renumbered.

**Sections:** Status (Proposed / Accepted / Superseded by NNNN) · Date · Context · Decision ·
Alternatives considered (and why rejected) · Consequences.

**When to write one:** any choice that is expensive to reverse or that a newcomer would otherwise
question — the facet ontology, schema shape, the classification contract, auth posture, etc.

## Index
- [0001 — Faceted, non-category data model](0001-faceted-data-model.md) — Accepted
- [0002 — Repository as a living knowledge base](0002-repository-as-knowledge-base.md) — Accepted
- [0003 — Facet ontology + data model (storage architecture)](0003-facet-ontology-and-data-model.md) — **Proposed (awaiting approval)**
- [0004 — LLM classification contract (evidence shape + confidence/unknown)](0004-llm-classification-contract.md) — **Proposed (awaiting approval)**
- [0005 — Conditions → capabilities recommendation engine (general, not per-trip)](0005-conditions-to-capabilities-engine.md) — Accepted
- [0006 — Phase 2: NL parser + offline fallback, review-before-save draft lifecycle, Postgres lossless jsonb](0006-phase2-nl-parser-draft-lifecycle-postgres.md) — Accepted
- [0007 — Classification cache: self-building knowledge base](0007-classification-cache.md) — Accepted
- [0008 — Real auth + multi-user: Supabase Auth, cookie sessions, RLS enforcement model](0008-auth-multi-user.md) — Accepted
- [0009 — Scope unlock: image/photo/barcode enrichment, military/NSN domain, native app moved to unlocked backlog](0009-scope-unlock.md) — Accepted
- [0010 — Layering-system reasoning: combination-aware capability evaluation](0010-layering-system-reasoning.md) — Accepted
- [0011 — Manufacturer URL enrichment: SSRF-gated fetch, JSON-LD+OG parsing, provenance overlay](0011-manufacturer-url-enrichment.md) — Accepted
- [0012 — Evidence-first classification: classification as an auditable argument](0012-evidence-first-classification.md) — Accepted
- [0013 — Cache split: `llm_draft_cache` (global) + `user_overrides` (per-user)](0013-cache-split-per-user-overrides.md) — Accepted
- [0014 — Evidence store + claims-based LLM (Phase 3 of evidence-architecture migration)](0014-evidence-store-claims-llm.md) — Accepted
- [0015 — Weather auto-conditions: Open-Meteo geocoding + forecast, override-always](0015-weather-auto-conditions.md) — Accepted
- [0016 — Demo guest funnel: seeded sample closet + "log in to save" wall](0016-demo-guest-funnel.md) — Accepted
- [0017 — Ops hardening: in-process rate limiter, structured console logging, error boundaries](0017-ops-hardening.md) — Accepted
