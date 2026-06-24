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
import { classifyOffline } from "@/core/classify/offline";
import { parseTripConditions, parseConditionsHeuristic } from "@/core/recommend/parse-conditions";
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

export function getClassifier(): ClassifierHandle {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const anthropic = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
    return { kind: "claims", classify: (input) => classifyItemClaims(input, { anthropic }), mode: "live" };
  }
  return { kind: "resolved", classify: async (input) => classifyOffline(input), mode: "offline" };
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
    return { parse: (d) => parseTripConditions(d, { anthropic }), mode: "live" };
  }
  return { parse: async (d) => parseConditionsHeuristic(d), mode: "offline" };
}
