# ADR-0009 — Scope unlock: image/photo/barcode enrichment, military/NSN domain, native app

**Status:** Accepted
**Date:** 2026-06-21

---

## Context

From project inception through Phase 2, three items were listed as hard out-of-scope with an explicit
"do not build; stop and flag" instruction in `CLAUDE.md` and `docs/roadmap.md`:

1. Image-upload / photo / barcode enrichment
2. Military/NSN domain
3. A native app

The rationale at the time was that none of these were needed to validate the core facet-reasoning
model (the main risk), each would introduce significant new infrastructure or scope, and keeping the
boundary tight let Phase 2 land cleanly. The prohibition was intended to be a forcing function for
focus, not a permanent architectural judgement.

On 2026-06-21 the user directed that all three items be moved out of the "never build" category and
into an allowed-but-gated backlog.

---

## Decision

**The hard block is lifted.** Image-upload / photo / barcode enrichment, the military/NSN domain,
and a native app are no longer prohibited. They become an **unlocked backlog**: any of them may be
proposed, designed, and built when prioritized, subject to the standard gating discipline that applies
to every non-trivial feature.

**Gating discipline is unchanged and still mandatory.** Unlocking is not a build authorization. Each
item on the unlocked backlog still requires, before any implementation begins:

- A `DESIGN.md` update covering the new data shapes, integration seams, and in-phase vs deferred
  scope.
- One or more ADRs for load-bearing decisions (provider choice, schema changes, infrastructure
  additions).
- The "ask first before adding a dependency or introducing new infrastructure" rule remains fully in
  force — a 20-second question before any new dependency lands.

"Unlocked" means **allowed + backlog, each gated on its own decision**. It does not mean greenlit
to build immediately or without a decision.

---

## Item-specific notes

### Barcode enrichment

Barcode scanning is deferred until after Phase 3 step 2 (manufacturer URL enrichment). The user
noted that barcode scanning is better suited to a native app than a browser tool — camera access via
browser APIs is technically feasible but the UX is materially worse than a native camera integration,
making it a low-utility browser feature. The recommended sequencing is:

1. Phase 3 step 2: manufacturer URL enrichment (paste-a-URL) lands first — this is the prioritized
   "easier item input" path and establishes the enrichment pipeline that barcode data would feed.
2. After URL enrichment is validated, barcode can be proposed as an enhancement to that pipeline,
   with native app delivery as the primary target.

Photo enrichment (upload an image to assist classification) is not separately prioritized and follows
the same gating discipline.

### Military/NSN domain

Unlocked in principle. However, this is a **large strategic pivot** — the NSN (NATO Stock Number)
catalog, military nomenclature, and military-specific facets (MOLLE compatibility, ballistic rating,
camouflage pattern, mil-spec standards) represent a domain with its own ontology, catalog source, and
likely a distinct user base. Any proposal to build this out requires a dedicated scoping decision and
ADR before any code or schema work. Do not treat the unlock as a green light to add military facets
incrementally; treat it as permission to write the scoping ADR.

### Native app

Unlocked in principle. This is also a **large strategic pivot** — a native app (iOS, Android, or
cross-platform via React Native / Expo) is a distinct delivery vehicle that introduces a new build
pipeline, platform-specific distribution, and potentially a different auth and data-sync model.
The web app (Next.js) remains the primary delivery target. A native app proposal requires its own
scoping decision and ADR before any work begins. The unlock is permission to write that ADR, not
to begin building.

---

## Alternatives considered

**Keep the hard block.** Rejected by the user. The "do not build" framing was intended to enforce
Phase 2 focus, not to be a permanent constraint.

**Greenlight all three items as active Phase 3 work.** Rejected. These items are not sequenced into
the approved Phase 3 roadmap (auth → URL enrichment → weather → catalog gap-fill). They become
backlog candidates for prioritization after or alongside Phase 3, each requiring their own decision.

**Unlock barcode alongside URL enrichment (same priority).** Rejected. The user explicitly noted
barcode is better native-first and should follow URL enrichment, not race it.

---

## Consequences

- `CLAUDE.md`, `docs/roadmap.md`, and the progress log are updated to reflect the unlocked-backlog
  framing.
- The approved Phase 3 sequence (steps 1–4) is unaffected.
- The "ask first" discipline for new dependencies/infra is unaffected.
- Agents encountering a proposal to build any of these items should no longer flag it as prohibited;
  they should instead verify that the relevant gating steps (design, ADR, dependency decision) are
  satisfied before any implementation.
