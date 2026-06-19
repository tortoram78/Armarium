# Armarium Knowledge Base

This `docs/` tree is a **first-class part of the project**, not an afterthought. Armarium is built to
be a *living knowledge base*: research, design swarms, agent outputs, decisions, and progress are
captured here as durable, committed markdown so that any future contributor — human or AI — can
reconstruct **what** we built and **why** by reading the repo alone. Nothing of value is left to
evaporate with a chat session.

See [`CLAUDE.md`](../CLAUDE.md) (repo root) for the project's operating rules and guiding principle.

## How this knowledge base is organized

| Path | What lives here |
|------|-----------------|
| [`decisions/`](decisions/) | **ADRs** — one file per load-bearing decision: context, decision, alternatives rejected, consequences. Start here to understand *why*. |
| [`phase0/`](phase0/) | **Design / discovery** artifacts from the Phase 0 swarm: `investigation/` (domain + cross-cutting research), `architectures/` (competing model proposals), `audits/` (adversarial stress-tests). |
| [`operating-model/`](operating-model/README.md) | **The Operating Kit** — the single operating model this repo runs under (nexus + sub-agents + gauntlet + retro loop). Read its README. |
| [`engineering-log.md`](engineering-log.md) | **Append-only retrospective log** — the self-improvement memory; `CLAUDE.md` holds the distilled rules. Written by `/retro`. |
| [`progress/`](progress/) | **Dated progress reports / session logs.** The project's narrative spine — skim to catch up fast. |
| `knowledge-base/` | **Curated, durable domain knowledge** distilled from the above (gear/material reference that outlives any one phase). Populated as the design stabilizes. |
| `../DESIGN.md` | The **synthesized** Phase 0 design: chosen facet ontology, data model, classification approach, rationale, rejected alternatives, edge cases. The single integrated artifact. |

## Conventions
- **Append-and-supersede, not delete:** when something is replaced, mark it superseded and link
  forward, so the reasoning trail stays intact.
- **ADRs are numbered** (`NNNN-title.md`) and never renumbered.
- **Swarm artifacts** state their author-role at the top and live under the relevant `phase*/` dir.
- **Commit cadence:** commit artifacts as they reach a coherent state; push to the working branch.
