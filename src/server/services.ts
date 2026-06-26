// Composition root (edge): selects the repository and classifier from the environment, so the rest of
// the app (route handlers, server actions, pages) depends only on these factories. Reads env HERE, not
// in core.

import Anthropic from "@anthropic-ai/sdk";
import type { GearRepository, ClassificationCacheRepository } from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { LlmClaimsOutput } from "@/core/classify/claims";
import type { ClassifyInput } from "@/core/classify/prompt";
import type { TripConditions } from "@/core/conditions";
import { classifyItemClaims } from "@/core/classify/classify-claims";
import { classifyOfflineSafe } from "@/core/classify/offline";
import { parseTripConditions, parseConditionsHeuristic } from "@/core/recommend/parse-conditions";
import { extractViaWebSearch, type WebSearchResult } from "@/core/enrich";
import type { LlmUsage } from "@/core/obs/log";
import { logEvent } from "@/lib/logger";
import { memoryRepository } from "./memory-repo";
import { memoryCache } from "./memory-cache";
// Static imports are safe because postgres-repo.ts / postgres-cache.ts construct the DB client
// LAZILY (only on first query, never at import time). Importing these modules has zero connection
// side effects, so build/test/typecheck stay green with no DATABASE_URL.
import { postgresRepository } from "./postgres-repo";
import { postgresCache } from "./postgres-cache";

/** v0 single fixed user (one-password gate; no real auth). */
export const DEFAULT_USER_ID = process.env.ARMARIUM_USER_ID ?? "00000000-0000-0000-0000-000000000001";

// The reserved guest identity lives in auth.ts (the layout/middleware read it without pulling in this
// server-only module). Re-export it here so server modules (app-service) share ONE constant and can
// route guest traffic to the in-memory repo. GUEST_USER_ID is in-memory ONLY — it NEVER touches Postgres.
export { GUEST_USER_ID } from "@/lib/auth";
import { GUEST_USER_ID } from "@/lib/auth";

let repo: GearRepository | null = null;

/** Postgres repo is wired when DATABASE_URL is set; in-memory otherwise (always runnable).
 *  The static import of postgres-repo is safe because the DB client is created lazily (only on
 *  first query, never at module evaluation time). No DATABASE_URL required at build/test. */
export function getRepository(): GearRepository {
  if (repo) return repo;
  repo = process.env.DATABASE_URL ? postgresRepository : memoryRepository;
  return repo;
}

/** The in-memory repository, unconditionally — independent of DATABASE_URL. This is the GUEST backing
 *  store: a guest browses the SEED_CORPUS (auto-seeded per user id by the memory repo's ensureSeeded) and
 *  NEVER reads or writes Postgres, even in production where DATABASE_URL is set. Exposed so the guest-aware
 *  selector (and tests) can force the memory path. */
export function getMemoryRepository(): GearRepository {
  return memoryRepository;
}

/**
 * Guest-aware repository selector — the ONE place that decides which backing store a user_id reads from.
 *
 *   - GUEST_USER_ID            → ALWAYS the in-memory repo (never Postgres), so a guest's sample closet is
 *     served from the seeded corpus and the guest id can never become a Postgres tenant (rule #4).
 *   - any authenticated/dev id → the env-selected repo (Postgres when DATABASE_URL is set, memory otherwise)
 *     — the existing path, UNCHANGED.
 *
 * Used by READ paths (getInventory/getCloset/getItem/planPreview). Write paths stay behind
 * requireUserId() and never receive GUEST_USER_ID, so this selector is read-shaped by intent.
 */
export function getRepositoryFor(userId: string): GearRepository {
  return userId === GUEST_USER_ID ? getMemoryRepository() : getRepository();
}

let cacheRepo: ClassificationCacheRepository | null = null;

/** The classification knowledge base. Postgres when DATABASE_URL is set, in-memory (seeded) otherwise.
 *  Static import of postgres-cache is safe — the DB client is created lazily (only on first query,
 *  never at module evaluation time). No DATABASE_URL required at build/test. */
export function getCacheRepository(): ClassificationCacheRepository {
  if (cacheRepo) return cacheRepo;
  cacheRepo = process.env.DATABASE_URL ? postgresCache : memoryCache;
  return cacheRepo;
}

// The classify abstraction is a DISCRIMINATED handle (ADR-0014 §3/§4): the ONLINE (LLM) classifier emits
// claims (`LlmClaimsOutput`, resolved downstream by the assembler); the OFFLINE classifier emits a resolved
// `ItemClassification` directly (seed/corpus — never claims). `kind` lets app-service branch; `mode` is the
// UI-facing live/offline flag (unchanged). The test mock constructs whichever handle a path needs.
export type ClaimsClassifier = (input: ClassifyInput) => Promise<LlmClaimsOutput>;
export type ResolvedClassifier = (input: ClassifyInput) => Promise<ItemClassification>;

/** Back-compat alias: a classifier that yields the resolved classification (the offline shape). */
export type Classifier = ResolvedClassifier;

export type ClassifierHandle =
  | { kind: "claims"; classify: ClaimsClassifier; mode: "live" }
  | { kind: "resolved"; classify: ResolvedClassifier; mode: "offline" };

// The ONE place LLM token usage from a live call is logged. Passed as `onUsage` into the core deps; core
// only reports the counts (it never imports a console), the console sink lives here in the server logger.
// The OFFLINE handle never constructs this dep, so the offline path logs no LLM usage (no model call).
const logLlmUsage = (action: "classify" | "parse" | "search") => (llm: LlmUsage): void =>
  logEvent({ level: "info", event: "llm", action, llm });

export function getClassifier(): ClassifierHandle {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const onUsage = logLlmUsage("classify");
    return { kind: "claims", classify: (input) => classifyItemClaims(input, { anthropic, onUsage }), mode: "live" };
  }
  return { kind: "resolved", classify: async (input) => classifyOfflineSafe(input), mode: "offline" };
}

export type TripParser = (description: string) => Promise<TripConditions>;

export interface TripParserHandle {
  parse: TripParser;
  mode: "live" | "offline";
}

/** NL trip parser: live LLM when a key is present, deterministic heuristic otherwise. */
export function getTripParser(): TripParserHandle {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    const onUsage = logLlmUsage("parse");
    return { parse: (d) => parseTripConditions(d, { anthropic, onUsage }), mode: "live" };
  }
  return { parse: async (d) => parseConditionsHeuristic(d), mode: "offline" };
}

export interface WebSearchEnricherHandle {
  /** Run a citation-gated web-search product lookup (restricted to the manufacturer allowlist in core). */
  enrich: (query: { name?: string | null; url?: string | null }) => Promise<WebSearchResult>;
  /** True when an ANTHROPIC_API_KEY is present (the web-search tier is live). */
  available: boolean;
}

/**
 * Web-search enrichment factory (ADR-0020): live when ANTHROPIC_API_KEY is set, an inert no-op otherwise
 * (so the hermetic gate and any keyless deploy behave exactly as before). The Anthropic client gets a
 * longer timeout than classify — the server-side `web_search` loop (multiple searches + reasoning) is
 * slower than a plain completion; kept under the route's `maxDuration=60` ceiling.
 */
export function getWebSearchEnricher(): WebSearchEnricherHandle {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const anthropic = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 });
    const onUsage = logLlmUsage("search");
    // OPEN enrichment (ADR-0029): `allowlist: []` lifts the domain hardcap so web search spans the whole
    // web for ANY brand. Honesty is preserved by the citation gate in core (the cited URL must be one the
    // search tool actually returned). No SSRF surface here — Claude's server does the fetching, not ours.
    return { enrich: (query) => extractViaWebSearch(query, { anthropic, onUsage, allowlist: [] }), available: true };
  }
  // Keyless: an inert handle — `available:false` means app-service never invokes `enrich`.
  const empty: WebSearchResult = {
    extracted: {
      name: null, brand: null, sku: null, mpn: null, price_cents: null, price_currency: null,
      weight_grams: null, material_raw: null, fiber_components: [], specs: [], source: "none",
    },
    sourceUrl: null,
  };
  return { enrich: async () => empty, available: false };
}
