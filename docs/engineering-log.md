# Armarium Engineering Log (self-improving)

Append-only retrospective log. After each iteration, the **`retrospective`** agent (or **`/retro`**)
diffs what changed since the last entry, diagnoses *why*, records the durable lesson here, and promotes
broadly-applicable rules into `CLAUDE.md`'s "Engineering lessons" section. Full detail lives here;
CLAUDE.md holds only the distilled rules.

Entry format per change — **Delta** · **Why** · **Lesson** · **Promoted**.

---

## 2026-06-19 — Phase 0 design + Phase 1 foundation + Phase 2 UI start (analyzed through `32eb66d`)

First retrospective. Covers the project from the empty repo through the in-progress Phase 2 UI, written
as we adopt the Operating Kit. The keystone learnings are promoted to `CLAUDE.md`.

### Phase 0 ran as a 16-agent swarm and converged on a hybrid faceted model
- **Delta:** 9 investigation agents → 3 blind competing architectures → 3 adversarial audits → one
  integrated `DESIGN.md` (capability-first hybrid backbone, facet registry, composable domain groups),
  ADRs 0001–0005, ~6.7k lines of committed artifacts. The user approved the hybrid + all five group stubs.
- **Why:** the load-bearing risk is the data model; competing-then-auditing surfaced the real fork
  (storage) and let synthesis harvest the best of each (A's evidence shapes, B's registry, C's capability
  layer) while every auditor's top fix was folded in.
- **Lesson:** for a load-bearing design decision, parallelize investigation, run *blind* competing
  proposals + adversarial audits, then synthesize — and surface the one genuine fork to the human rather
  than silently picking.
- **Promoted:** no (process captured in the Operating Kit's parallel-dispatch + design-before-build).

### The defining invariant: facets, not categories — and not hardcoded trips
- **Delta:** items are bundles of facet values; closet grouping is a query (`src/core/closet.ts`),
  recommendations derive from `conditions → capabilities` (`recommend/derive.ts`). No `Category` enum.
- **Why:** real gear is multi-purpose (the buff, the R1 Air); a category model forces one false truth and
  hardcodes the advice we want to derive.
- **Lesson:** model dimensions; let grouping/recommendation emerge as queries.
- **Promoted:** **yes** (Architecture rule #1).

### MISS → FIX: the recommender collapsed onto one trip (Marcy)
- **Delta:** the first recommender hardcoded a "Mount Marcy" required-capability set; the canonical test
  passed but no other trip worked. Fixed by `TripConditions` + `deriveRequirements()` + cross-archetype
  tests (desert/rain/casual/alpine each derive different requirements). (ADR-0005.)
- **Why:** optimizing for the one verification case made the engine pass while being secretly
  non-general — the same anti-pattern as category buckets, one layer up. The user caught it ("too small
  scoped").
- **Lesson:** **a passing canonical test is not proof of generality.** For any reasoning feature, add
  ≥3 distinct-archetype tests so the engine can't be hardcoded to the demo.
- **Promoted:** **yes** (Engineering lessons).

### The four gates stay green with no DB and no API key
- **Delta:** DB client + Anthropic client are lazy/injected; tests use a mock Anthropic client and an
  offline classifier; in-memory repository seeded from the corpus. `typecheck/lint/build/test` all green
  in a sandbox with neither secret.
- **Why:** a verification gate that needs a secret can't run in CI/sandbox and silently rots.
- **Lesson:** never make a gate depend on a secret; inject clients, provide offline/mocked paths.
- **Promoted:** **yes** (Engineering lessons).

### Unknown is first-class; specs are never fabricated — enforced mechanically
- **Delta:** `Evidence<T>`/`HardFact<T>` with a `hardFact` preprocess that demotes any inferred hard
  fact to `null+unknown`; failing-fixture tests assert it; the Kelty "30" is stored with
  `temp_rating_standard` uncertain (never upgraded to EN/ISO).
- **Why:** a wrong spec produces unsafe recommendations; prompt wording alone can't guarantee honesty.
- **Lesson:** enforce the unknown/no-fabrication rule in code (a guard) and protect it with failing
  fixtures, not by trusting the model.
- **Promoted:** **yes** (Architecture rule #2 + Engineering lessons).

### Knowledge captured as committed markdown throughout
- **Delta:** every swarm artifact, ADR, and progress note is committed under `docs/`; pushed each step.
- **Why:** the remote container is ephemeral — uncommitted reasoning evaporates and gets re-derived.
- **Lesson:** commit research/decisions as you go; the repo is the knowledge base.
- **Promoted:** **yes** (Architecture rule #6 + Engineering lessons).

### Phase 2 UI started, then paused to adopt the Operating Kit
- **Delta:** design-system primitives, one-password gate, app-service, server actions, closet + add
  pages (builds green); paused at the user's request to install the Operating Kit as the operating model.
- **Why:** the user introduced a portable operating model and wants it to govern all further work.
- **Lesson:** when the regime changes, retrofit the constitution (CLAUDE.md), the agents, the gauntlet,
  and this log *before* resuming feature work.
- **Promoted:** no (this entry is the record; the adoption commit will be analyzed by the next retro).

---

## 2026-06-19 — Phase 2 full web app: Postgres repo, NL parser, draft lifecycle, and RSC boundary fix (analyzed through `edac40f`)

Covers commits `0b723e3` (Phase 2 core: web app + Postgres repo + NL parser + draft lifecycle),
`137cfc6` (fix: item-detail 500 — onSubmit across the server/client boundary), and
`edac40f` (docs: PROGRESS + ADR-0006 + deploy.md). Baseline: `32eb66d` (previous retro entry).

### Phase 2 shipped: full web app, Postgres repo, NL trip parser, and review/save draft lifecycle
- **Delta:** complete Phase 2 web app across closet, add-by-name → classify → review/save, plan-a-trip
  (NL + structured conditions → picks + capability gaps + "verify"), and saved trips. Postgres repository
  impl (lossless `classification` jsonb as read source-of-truth + projected hot columns). NL parser with
  offline heuristic fallback (ADR-0006). All four gauntlet gates green; live HTTP 200s and LLM-confirmed
  classification verified. ADR-0006 and deploy.md committed.
- **Why:** the Phase 0/1 foundation (facet model, capabilities engine, in-memory repo) was complete and
  approved; Phase 2 is the first deliverable the user can actually run and deploy.
- **Lesson:** ship end-to-end verticals on a proven foundation rather than layering depth incrementally —
  the in-memory repo let the web app, classification, and Postgres impl develop and gate independently.
- **Promoted:** no (confirms existing architecture and workflow; no new rule warranted).

### MISS → FIX: Server Component passed `onSubmit` to `<form>` — HTTP 500 at render despite clean build
- **Delta:** `/items/[id]` passed `onSubmit={() => confirm("Delete this item?")}` directly on a `<form>`
  inside a Server Component. `pnpm build` passed; `pnpm typecheck` passed. The route returned HTTP 500 at
  render. Fixed by extracting a small `"use client"` `ConfirmButton` that keeps the handler on the client
  side of the boundary. Verified live: GET returns 200, renders correctly, zero boundary errors.
- **Why:** Next.js App Router's RSC boundary constraint — event handler props cannot cross
  server→client — is a runtime invariant, not a compile-time one. TypeScript and the Next.js compiler
  accept the code; the violation only manifests as a render-time crash. `pnpm build` is a build-artifact
  gate, not a runtime-correctness gate.
- **Lesson:** **`pnpm build` passing is necessary, not sufficient.** For any new or changed RSC route,
  probe it live (`next start` + assert HTTP 200 + spot-check rendered content). The specific trap:
  event-handler props (`onClick`, `onSubmit`, etc.) silently compile in Server Components but crash at
  render — any interactive behaviour needs a `"use client"` component wrapper.
- **Promoted:** **yes** — sharpens the existing Workflow gauntlet to make live-probe a named requirement
  for RSC route changes, not just a visual screenshot check.

### Partial file swept into an unrelated fix commit via `git add -A`
- **Delta:** `137cfc6` (the boundary fix) inadvertently included a partial draft of `PROGRESS.md` because
  `git add -A` was run while the docs-owner agent was still writing. The docs commit `edac40f` then
  completed and overwrote it cleanly, so no data was lost — but the fix commit's diff is polluted with
  90 lines of unrelated progress notes.
- **Why:** `git add -A` is a sweep that captures the entire working tree at that instant, including files
  owned by a concurrently-running writer agent. The fix author and the docs agent were both active on the
  same working tree.
- **Lesson:** **scope `git add` to your own files; never use `-A` while a delegated writer agent is
  active.** Stage by explicit path (e.g., `git add src/app/... src/components/...`), or commit before
  dispatching writers and only re-stage after they settle.
- **Promoted:** **yes** — new rule; broadly applicable whenever parallel agents share a working tree.

### In-memory repository is per-process — stateful flow verification needs a shared store
- **Delta:** verifying stateful multi-step flows (classify → review → save → trip result) required
  driving the real UI or connecting to Postgres, because a helper script that seeds the in-memory repo
  can't see a separate `next start` server's store.
- **Why:** the in-memory impl is a correct single-process singleton. The constraint is fundamental to
  the architecture, not a bug.
- **Lesson:** for stateful end-to-end flows, either drive via the real UI (form submits) or use Postgres.
  Scripted seeding only works against the test harness (same process).
- **Promoted:** no (narrow verification-tooling note; doesn't generalise beyond this architecture's
  in-memory/Postgres split).

---

## 2026-06-20 — Verify→correct→re-plan loop, self-building classification cache, Phase 3 greenlight (analyzed through `c77884b`)

Covers commits `5f18bac` (core: correction engine + re-plan spine), `7ab1fbe` (web: verify loop UI +
end-to-end proof), `2c77699` (feat: self-building classification cache), `a80937f` (db: durable Postgres
cache + docs), and `c77884b` (docs: Phase 3 scope greenlight). Baseline: `edac40f`.

### Verify→correct→re-plan loop closes the feedback cycle
- **Delta:** `src/core/corrections.ts` — `applyUserCorrections()` builds `source:"user"` envelopes so a
  corrected hard fact (fill_power, temp_rating, upf, seam_sealing, capacity) is AUTHORITATIVE and
  survives the `hardFact` demotion guard, actually moving capability outcomes. `replanTrip()` re-runs a
  saved trip against the current closet and persists the new result. UI: FacetEditor is now
  registry-driven (EDITABLE_UNIVERSAL/GROUPS/MULTILABEL), trip detail shows "Re-plan with current
  closet," and each uncertain/blocked item deep-links to `/items/[id]?edit=1`. Service-level integration
  test (`test/verify-loop.integration.test.ts`) pins the payoff: correction propagates through re-plan,
  result is persisted.
- **Why:** Phase 2 could surface gaps ("verify") but offered no path to resolve them — the loop was open.
  Connecting corrections → capability re-evaluation → saved-result update closes it end to end.
- **Lesson:** an open feedback loop (gap surfaced, no fix path) has zero payoff. Design the full cycle —
  detect → correct → re-evaluate → persist — before shipping the detection UI.
- **Promoted:** no (architectural principle; the specific pattern is already encoded in the design;
  the general "close the loop" rule is too abstract without a crisper formulation than what's already
  in the workflow rule about evidence and root causes).

### MISS → NOTICED: capability/outcome test initially asserted the wrong lever
- **Delta:** the integration test for the verify loop originally cleared `upf` alone to "disprove"
  sun_protection, but the gate is `upf>=30 OR function_purpose⊇"sun_protection"` — so the test passed
  with the item still in picks (the second lever was still set). The test was then written to clear
  BOTH levers (`universal.upf: "unknown"` AND `multilabel.function_purpose: []`), which correctly
  removes the item. The initial version would have asserted the right outcome for the wrong reason.
- **Why:** the gate predicate was assumed from memory rather than read from `src/core/capabilities.ts`.
  An OR-predicate with two arms only fails when ALL arms fail; clearing one arm while leaving the other
  is not a real correction.
- **Lesson:** **when a test asserts a capability outcome, read the actual gate before asserting.**
  Capability gates are often OR-predicates across multiple facets; clearing one facet may leave the item
  still satisfying the gate through another arm. Assert against the full real predicate.
- **Promoted:** yes (new; broadly applicable to any capabilities test, now or in Phase 3).

### Self-building classification cache — corrections feed the KB
- **Delta:** `src/core/cache.ts` defines `normalizeCacheKey` (accent-fold, lowercase, punctuation→space)
  and the `CachedClassification` shape. A `ClassificationCacheRepository` port backs two impls:
  in-memory (seeded from the corpus, so known items hit instantly) and Postgres (`classification_cache`
  table, ADR-0007). `classifyToDraft` consults the cache before calling the LLM; `confirmDraft` and
  `updateItemClassification` upsert `source:"user"` entries so every correction improves the next add.
  Three new tests pin: cache hit before classifier, cache-before-LLM ordering, correction-feeds-KB.
- **Why:** repeat adds were re-deriving the same classification at LLM cost, and user corrections were
  ephemeral — the next add of the same item regressed to the original inferred facets. A name-keyed KB
  makes every correction durable and shared.
- **Lesson:** for any derived-data system where user corrections exist, route corrections back into the
  source so future derivations inherit them — don't let a cache diverge from user intent.
- **Promoted:** no (the single-source-of-truth principle is implicit in Architecture rule #2; the
  specific cache-feedback pattern is too narrow to stand as a top-level rule).

### Docs fixed: `deploy.md` claimed offline classifier returns a "minimal default" — it throws
- **Delta:** `deploy.md` stated "any unknown item receives a minimal default classification." The
  Postgres-cache commit (`a80937f`) corrected it to "any unknown item causes `classifyOffline` to throw
  an error directing the user to set `ANTHROPIC_API_KEY`. No default or fabricated classification is
  returned." The code's actual behavior (the throw) was already present; the doc was wrong from the
  prior iteration.
- **Why:** the doc was written before the offline behavior was pinned precisely, and the cache commit
  author noticed the discrepancy when writing the note "the offline classifier throws on novel items"
  in the commit message.
- **Lesson:** **verify doc claims about fallback/error paths against the code before shipping.** Docs
  about "what happens when X is absent" drift silently — a quick read of the relevant function
  (or a single test run) is the check.
- **Promoted:** yes (new; broadly applicable whenever documenting fallback or absence behavior; the
  existing "commit research as markdown" rule says to write docs, but doesn't say to verify them against
  the code).

### Phase 3 greenlit and sequenced in CLAUDE.md + roadmap.md
- **Delta:** `CLAUDE.md` Scope discipline section updated from "Phase 2 only" to "Phase 2 complete,
  Phase 3 approved — (1) Supabase Auth + RLS → (2) URL enrichment → (3) weather auto-conditions →
  (4) catalog gap-fill suggestions." `docs/roadmap.md` added with sequenced phases and explicit
  provider decisions gated at the start of each step.
- **Why:** the user greenlit Phase 3 after reviewing the complete Phase 2 including the verify loop and
  KB. Committing the sequence to the repo prevents phase-boundary drift and makes the next-action
  unambiguous for any agent reading CLAUDE.md.
- **Lesson:** commit scope decisions immediately as they happen (existing rule; confirmed effective here).
- **Promoted:** no (confirms existing "commit research/decisions as markdown" lesson).

---

## 2026-06-21 — Phase 3 step 1: real auth + multi-user + RLS; two-skin visual overhaul; scope unlock (analyzed through `1211f04`)

Covers commits `cea6cca` (Supabase Management API migrator), `5190c60` (Phase 3 auth + RLS),
`a77a568` (require→static-import fix), `d54a705` (framer-motion dep), `d39f416` (two-skin pass 1),
`d03cfec` (Opus redo — field-dossier skin), `9ddc7f5` (scope unlock ADR-0009), `1211f04` (skin
rollout + green adjust). Baseline: `c77884b`.

### Sandbox egress is HTTP/HTTPS-proxy-only — raw Postgres unreachable; Management API fills the gap
- **Delta:** `drizzle-kit migrate` couldn't connect (5432/6543 blocked). `scripts/db-mgmt-migrate.mjs`
  was built to apply Drizzle migrations over HTTPS via the Supabase Management API, recording each in
  `drizzle.__drizzle_migrations` exactly as `drizzle-kit` would, so a normal migrate from a
  DB-connected env stays in sync. Used to apply migrations 0000–0002 to the live project (verified:
  12 tables, 12 FKs, GIN indexes, tracking rows).
- **Why:** Claude Code's cloud sandbox routes all egress through an HTTP/HTTPS proxy; raw TCP on
  port 5432/6543 is not reachable. This is a persistent constraint of the environment, not a
  one-off config issue.
- **Lesson:** the cloud sandbox cannot reach raw Postgres — use the Supabase Management API for
  migrations, and expect the same constraint for any service that speaks raw TCP. For upcoming URL
  enrichment (and any outbound HTTP): test against fixtures first, then verify on Vercel where actual
  egress is unrestricted.
- **Promoted:** yes — new rule about the sandbox egress constraint; broadly applicable to any work
  that needs DB or arbitrary-HTTP connectivity inside this environment.

### Phase 3 step 1: Supabase Auth + RLS ships; one-password gate retired
- **Delta:** `src/lib/supabase/{server,client,middleware}.ts` (SSR cookie sessions), `src/lib/auth.ts`
  (`isAuthConfigured()` / `getCurrentUserId()` / `requireUserId()` with dev passthrough when env is
  absent), `src/middleware.ts` (session refresh + route protection), `/login` + `/signup` pages,
  `drizzle/0003` (RLS + `auth.uid()=user_id` ownership policies on every user-owned table). All four
  gauntlet gates green with no env (passthrough mode). ADR-0008 committed.
- **Why:** Phase 2 had a one-password gate and a fixed user id; Phase 3 step 1's contract is real
  per-user isolation end to end. RLS guards the public PostgREST/anon surface (the anon key is public);
  the app's postgres-role connection bypasses RLS and filters at the app layer.
- **Lesson (NEXT_PUBLIC env inlined at build):** `NEXT_PUBLIC_*` env vars are baked into the JS bundle
  at `next build` time. A gate like `isAuthConfigured()` that reads them will always reflect the
  build-time env — unsetting the vars at runtime changes nothing. Testing the unconfigured/passthrough
  path requires a build with those vars absent, not just a runtime unset.
- **Promoted:** yes — new rule; affects any feature toggled on a `NEXT_PUBLIC_*` flag (auth, future
  enrichment toggles, etc.).

### MISS → FIX: `require()` vs. static-import drift in services.ts
- **Delta:** `getCacheRepository()` used `require("./postgres-cache")` — failing under vitest's ESM
  mode and a riskier bundling path — while its sibling `getRepository()` used a static import and the
  in-file comment already claimed a static import. Fixed in `a77a568` (one commit, 12-line change).
- **Why:** the `require()` call was written without checking the sibling factory's pattern. The
  comment and the code disagreed; the discrepancy was only caught because vitest exposed it.
- **Lesson:** when a module's own comment claims a pattern (e.g., "static import"), verify the code
  matches the comment; and match the sibling's proven pattern rather than improvising. `require()` in
  ESM-first codebases is a silent incompatibility that only surfaces at test or bundle time.
- **Promoted:** no — specific to a `require()`/ESM mismatch in this one file; the general rule
  "read the actual code, not its summary" is already covered by the agent-verification lesson below.

### The gauntlet is only hermetic at zero env
- **Delta:** running tests with `DATABASE_URL` set broke them (module-resolution + a Postgres
  connection timeout during test); the canonical gate requires no env vars.
- **Why:** the in-memory path is the designed-for-testing path; the Postgres path requires a live DB
  that isn't available in the test environment. Injecting `DATABASE_URL` switches branches to the
  Postgres impl, which then times out.
- **Lesson:** the hermetic gate (`pnpm typecheck && pnpm test`) requires no env. Running it with
  `DATABASE_URL` set invalidates the hermetic guarantee. Gate invocations in CI or a validation step
  must explicitly strip DB/API env vars — or document that the hermetic pass is always a clean-env run.
- **Promoted:** yes — sharpens the existing "keep secrets/infra out of the gates" rule; the new
  nuance is that even having the var set (not just requiring it) breaks hermetic.

### Visual overhaul: first skin rejected as bubbly; Opus redo landed the field-dossier aesthetic
- **Delta:** pass 1 (`d39f416`) built a two-skin CSS-variable token system (Refined / Modern Trail)
  but the rugged skin read as soft/rounded/AI-esque — rounded pills, drop-shadows, generic colors.
  The user redirected ("less bubbly, finer corners, tactile"). An Opus pass (`d03cfec`) replaced it:
  0–2 px radius throughout, depth via 1 px hairlines and letterpress insets not shadows, Oswald
  structural labels + JetBrains Mono for data, blaze-orange as punctuation only, clip-path wipe
  transition. The skin was then rolled across all content pages (`1211f04`).
- **Why:** the first pass used defaults and aesthetic conventions from common design systems (rounded,
  shadow-depth, pastel accents); the target was a deliberate counter-aesthetic (instrument panel,
  field dossier, USGS topo). Without concrete negative anti-patterns ("no pills, no drop-shadows,
  edges not depth") a capable-but-vague prompt lands in the safe middle.
- **Lesson:** subjective design language needs concrete anti-patterns, not just mood words. Validate
  the design language on one flagship screen with explicit direction — and on a stronger model if the
  result reads generic — before rolling wide. A second-pass cost is far lower than a full rollout of
  a rejected aesthetic.
- **Promoted:** yes — new rule; broadly applicable to any future design-language or major UI work.

### Read the actual artifact, not the agent's summary
- **Delta:** an agent's report abbreviated the RLS migration with a "...same pattern" comment in its
  summary; only reading the actual `drizzle/0003_enable_rls_auth.sql` file confirmed it was complete
  (133 lines, every table covered, policies present).
- **Why:** agents summarize; summaries elide. A summary can be structurally correct ("RLS enabled on
  all tables") while omitting that the file actually contains the coverage.
- **Lesson:** always read the actual artifact (file, output, schema) to confirm it — never rely on an
  agent's summary of what it produced. This is the agent-facing version of "verify doc claims against
  the code."
- **Promoted:** yes — sharpens existing lesson on verifying doc claims; the new angle is specifically
  about agent-produced summaries of their own artifacts.

### Scope unlock committed as ADR-0009
- **Delta:** the hard "out of scope" block on image/barcode/military/native-app was lifted per user
  direction 2026-06-21. ADR-0009 captures the decision; CLAUDE.md and roadmap.md updated in the same
  commit.
- **Why:** the prototype constraints (keep it tiny, no extra surface area) no longer bind after Phase 2
  delivery; the user chose to unlock the backlog while keeping each item individually gated on its own
  ADR + dep decision.
- **Lesson:** scope unlock is still a decision — commit it with the same ADR discipline as a scope
  add. The gating condition (ADR + dep decision per item) stays in CLAUDE.md so it isn't lost.
- **Promoted:** no (confirms existing "commit decisions as markdown" lesson; no new rule needed).
