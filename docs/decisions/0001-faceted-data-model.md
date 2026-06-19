# 0001 — Faceted, non-category data model

**Status:** Accepted (project-defining constraint)
**Date:** 2026-06-19

## Context
Armarium recommends what to pack for a trip. The naive design is fixed category buckets
(`BaseLayer`, `MidLayer`, `Shell`, …) with routing logic per bucket. Real gear defies this: a sun
hoody is also a light mid; a buff is a hat, a neck gaiter, and a sun layer at once; active-insulation
is both insulation and a breathable mid. Category enums force a single truth onto multi-purpose items
and make recommendations brittle and non-extensible.

## Decision
Model **dimensions / facets** (function/purpose, conditions-fit, material behavior, layering role,
active-vs-static, technical-vs-lifestyle, packability, …). An item occupies **many facets at once**.
Grouping and recommendations are **emergent queries / reasoning over the facet space**, not fixed
enums. Facets are assigned by **LLM analysis at ingest**, validated to a Zod schema, then stored.
Unknown facet values are `null` with a confidence/source marker — never guessed.

## Alternatives considered
- **Fixed category enum + per-category attributes.** Rejected: cannot represent multi-purpose items;
  recommendations become hardcoded per category; adding a domain means code changes.
- **Free-text tags only.** Rejected: not queryable with thresholds; no confidence; prone to LLM drift
  and synonym sprawl.

## Consequences
- The classification pipeline (Layer 1) is the core of the product and must be rigorous and validated.
- Recommendations are expressed as facet/capability queries (Layer 2); gap analysis ("no item meets
  capability X") falls out naturally.
- Requires disciplined confidence/unknown handling everywhere downstream.
