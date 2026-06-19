# 0002 — Repository as a living knowledge base

**Status:** Accepted
**Date:** 2026-06-19

## Context
This project is developed with heavy multi-agent research and design swarms, which produce large
amounts of valuable reasoning. If that work lives only in a chat session it evaporates: future
contributors (human or AI) repeat it or lose the rationale, and the ephemeral remote container that
runs sessions is reclaimed along with any uncommitted work.

## Decision
Treat the repository itself as the primary knowledge source. All research, agent outputs, design
rationale, and progress are captured as **durable, committed markdown** under `docs/` (see
[`docs/README.md`](../README.md) for the map) and pushed to the working branch. Decisions are recorded
as ADRs; progress is logged in `docs/progress/`. Artifacts are superseded, not silently deleted.

## Alternatives considered
- **Keep research ephemeral / in chat.** Rejected: loses rationale, not reproducible, and the
  ephemeral container takes uncommitted work with it.
- **One giant doc.** Rejected: doesn't scale, hard to diff, merge-hostile. Many focused MDs + indexes
  scale better.

## Consequences
- Slightly more overhead per investigation (write + commit the artifact).
- The repo is self-documenting; onboarding and future agent sessions start from committed context.
- Requires curation discipline (indexes, supersede markers) to avoid becoming a dumping ground.
