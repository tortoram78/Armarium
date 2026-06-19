# 04 — Verification & Validators

> Part of the [Operating Kit](README.md). This is the discipline that makes "done" mean *done*. The
> nexus ([`01`](01-operating-model.md)) runs the gauntlet on every "done" and surfaces the evidence
> to the human ([`06`](06-scope-phasing-and-comms.md#communication-discipline)).

---

## The first principle: evidence, not assertion

**Never say "it passed." Show that it passed.** A claim of success without the command output or the
screenshot is worthless — it's exactly the unverified output the nexus exists to keep away from the
human. Every "done" is accompanied by the artifact that proves it: the test output, the validator
report, the build log, the screenshot.

> **Worked example (StarGuide).** A passing commit's message records the evidence inline:
> *"typecheck clean, lint exit 0, validate:data (85 events) + geofenced validate:geojson (22
> features) pass, 55 tests pass, production build green (12 routes)."* The commit message *is* the
> artifact that the gauntlet ran. The retro noted this directly: *"Evidence of a passed gauntlet in
> the commit message is the artifact that proves it ran."*

---

## The gauntlet

Run the cheapest checks first so the run fails fast on the most common breakage:

```
1. typecheck        ── static types          (fastest; catches the most)
2. lint             ── style + correctness lint
3. domain validators── your data/schema/geometry/etc. validators  (see below)
4. tests            ── unit/integration; prefer ONE relevant test over the whole suite in-loop
5. build            ── the production build MUST pass — this is the hard gate
6. cross-reference  ── cross-domain integrity check after any multi-agent integration (see below)
7. screenshot       ── for any UI change: render it and check it against intent
```

Two standing rules around the gauntlet:

- **Every pushed commit must pass the production build locally first.** A shared branch with CI and
  deploys is **not a scratchpad**. Never checkpoint un-built, mid-integration WIP to it. If a hook or
  prompt pressures a commit while work is half-done, finish and verify first, or keep the commit
  local. (Docs/config-only commits are exempt.)
- **Fix root causes, not symptoms.** Never edit a validator, loosen a schema, or `// @ts-ignore` an
  error just to turn a check green. If a check is red, either the code is wrong (fix the code) or the
  check is wrong (fix the check *deliberately, with justification* — see the threshold example below).

> **Worked example (StarGuide), the cost of skipping it.** A partial, mid-integration snapshot was
> pushed to the shared branch while most coding agents were still writing. CI and the deploy went red
> and the PR was **closed**. Root cause: a Stop-hook prompted "commit your changes" and the agent
> optimized for the hook over a buildable state. The durable rule — *never push a commit that hasn't
> passed the build* — was promoted to `CLAUDE.md` from exactly this miss.

---

## Validators as gates — written *before* the artifact they guard

For any artifact whose *correctness isn't captured by types or a unit test* — structured data,
geometry, content cross-links, config invariants — write a **validator** that mechanically checks it,
and **write the validator before authoring the artifact.** With the safety net in place first, every
subsequent edit is cheap and instantly verifiable; written after, the validator is rationalizing
whatever already exists.

A good validator checks more than *shape*. It checks **placement, magnitude, and relationships** —
the questions a schema never asks:

- shape/structure (the schema already gives you this — necessary, not sufficient);
- **where** — does each value fall in the plausible range / region for its *kind*?
- **how big** — are sizes/counts within sane bounds (catch dropped signs, off-by-10⁶)?
- **containment / relationships** — does X actually sit inside Y where it must?
- a **hard outer limit** to catch the catastrophic typo, not just the subtle one.

### Protect the validator with a failing-fixture regression test

A validator is only a gate if it *can't be silently weakened*. Add regression tests that feed it
**known-bad fixtures** and assert it **rejects** them. Now a future change that guts a check fails the
test suite instead of quietly passing bad data.

> **Worked example (StarGuide).** The geometry validator was written *before* the real geometry was
> authored. It enforces a global bounding box for every centroid, **per-type sub-boxes** (a "launch"
> feature can't sit at the build site), **structure-in-parcel containment** via ray-cast, **size
> guards** (a structure under 0.02 ac or over 40 ac fails; a parcel over 10 sq mi fails), and a
> **hard outer limit** that catches a dropped minus sign. Nine regression tests feed it bad fixtures
> and assert each check still fires. The diagnosis that motivated it: *"a centroid in the Gulf of
> Mexico passed CI clean"* — the schema validated structure and winding but never asked *where*.
> Hand-authored axis-aligned rectangles read as "rudimentary" over imagery; the validator is the
> gate that forces real geometry.

### Adjust a threshold only after verifying the change is justified

When real data legitimately shifts a validator's threshold (a new valid case is slightly bigger than
the old bound), update the bound **and** sync the regression fixture — but **only after confirming the
new case is actually valid against ground truth**, not blindly to make the suite green. The fixture
moves *because the world moved*, with that justification recorded, never *because the check was
inconvenient.*

---

## The cross-reference check (after integration)

This is the check that catches what every *domain* validator misses. Each owner's validator checks
its own domain; the **seam between domains** — a record in one file that must correspond to an
artifact in another — is checked by neither. So after integrating multi-agent or multi-file output,
run an explicit **cross-domain integrity check**, and **put it in CI** (or your `validate:*` step),
not in manual inspection.

The shape is always: *every A that references a B resolves to a real B, and every B that should be
referenced by an A is.* Concretely, for a "content keyed to data records" relationship:

```
for each content file on disk:        its key must match a record that points back to it
for each record with a content key:   that key must resolve to a real content file
```

> **Worked example (StarGuide).** Prose explainers are keyed 1:1 to map features by an
> `explainerSlug`. After the parallel pass, several explainers existed but weren't linked from any
> feature (nine links had to be added). The data validator passed (schema-valid); the prose had no
> validator. The promoted rule: *"every explainerSlug on disk must have a matching feature, and every
> feature with an explainerSlug must resolve to a real .mdx — neither agent's domain validator catches
> the other side; this belongs in CI."* Generalize it to *any* cross-domain reference your project has.

---

## Beyond mechanical checks: visual and ground-truth verification

Schema + winding + geofence + cross-reference are **necessary but not sufficient.** Two classes of
error survive every mechanical check:

- **Visual errors** — the artifact is perfectly valid but *renders wrong*. Only looking at it
  catches these. Hence the **screenshot step** for UI, and the imagery/ground-truth auditor for
  modeled state.
- **Ungrounded facts** — the artifact is well-formed but the *claim is unsourced or false*. Only a
  citation auditor or a ground-truth cross-check catches these.

> **Worked example (StarGuide).** A data feature had three polygons placed ~28 km from where they
> belonged. The data was *flawless* by every mechanical check — RFC-7946 structure, right-hand
> winding, schema, and even the geofence (which bounded longitude but had missed latitude). **Only
> rendering the map exposed it.** Separately, a citation audit caught an uncited claim and three
> uncited figures pre-merge. The lesson: keep *two verifications beyond schema — visual and citation
> — because schema/winding/geofence are necessary but not sufficient.*

---

## CI mirrors the gauntlet

CI is the gauntlet run for everyone, on every push and PR — the backstop for when a local run was
skipped. Mirror the local steps in the same fail-fast order, and add the cross-reference check.

```yaml
# .github/workflows/ci.yml  (adapt the runner/commands to your stack)
name: CI
on:
  pull_request:
  push:
    branches: [main]

# One run per ref; a new push cancels an in-flight run for the same branch/PR.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: typecheck · lint · validate · test · build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6          # ← swap for your toolchain
        with: { node-version: 22, cache: npm }
      - run: «install (e.g. npm ci)»
      # Cheapest checks first so the run fails fast on the most common breakage.
      - run: «typecheck»
      - run: «lint»
      - run: «validate:data»                 # domain validators…
      - run: «validate:geojson»              # …including the cross-reference check
      - run: «test»
      - run: «build»
```

The `concurrency` block (cancel superseded in-flight runs) keeps CI from wasting minutes on commits
a newer push already replaced — small, worth copying.

---

## Checklist: what "done" requires

- [ ] typecheck, lint, domain validators, tests, **build** — all green, **output shown**
- [ ] cross-reference check run if multiple domains/agents touched it
- [ ] UI change → screenshot taken and checked against intent
- [ ] factual claims → grounded by a resolvable source (auditor clean)
- [ ] any check that's red → **root cause fixed**, nothing suppressed
- [ ] not pushed to a shared branch until the production build passed locally

Next: the loop that turns the misses these checks catch into permanent rules —
[`05` self-improvement loop](05-self-improvement-loop.md).
