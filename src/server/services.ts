// Composition root (edge): selects the repository and classifier from the environment, so the rest of
// the app (route handlers, server actions, pages) depends only on these factories. Reads env HERE, not
// in core.

import Anthropic from "@anthropic-ai/sdk";
import type { GearRepository, ClassificationCacheRepository } from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { ClassifyInput } from "@/core/classify/prompt";
import type { TripConditions } from "@/core/conditions";
import { classifyItem } from "@/core/classify/classify";
import { classifyOffline } from "@/core/classify/offline";
import { parseTripConditions, parseConditionsHeuristic } from "@/core/recommend/parse-conditions";
import { memoryRepository } from "./memory-repo";
import { memoryCache } from "./memory-cache";
// Static import is safe because postgres-repo.ts constructs the DB client LAZILY (only on first
// query, never at import time). Importing this module has zero connection side effects.
import { postgresRepository } from "./postgres-repo";

/** v0 single fixed user (one-password gate; no real auth). */
export const DEFAULT_USER_ID = process.env.ARMARIUM_USER_ID ?? "00000000-0000-0000-0000-000000000001";

let repo: GearRepository | null = null;

/** Postgres repo is wired when DATABASE_URL is set; in-memory otherwise (always runnable).
 *  The static import of postgres-repo is safe because the DB client is created lazily (only on
 *  first query, never at module evaluation time). No DATABASE_URL required at build/test. */
export function getRepository(): GearRepository {
  if (repo) return repo;
  repo = process.env.DATABASE_URL ? postgresRepository : memoryRepository;
  return repo;
}

let cacheRepo: ClassificationCacheRepository | null = null;

/** The classification knowledge base. Postgres when DATABASE_URL is set, in-memory (seeded) otherwise.
 *  Static import of postgres-cache is safe — the DB client is created lazily (only on first query,
 *  never at module evaluation time). No DATABASE_URL required at build/test. */
export function getCacheRepository(): ClassificationCacheRepository {
  if (cacheRepo) return cacheRepo;
  if (process.env.DATABASE_URL) {
    cacheRepo = (require("./postgres-cache") as { postgresCache: ClassificationCacheRepository }).postgresCache;
  } else {
    cacheRepo = memoryCache;
  }
  return cacheRepo;
}

export type Classifier = (input: ClassifyInput) => Promise<ItemClassification>;

export interface ClassifierHandle {
  classify: Classifier;
  mode: "live" | "offline";
}

export function getClassifier(): ClassifierHandle {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const anthropic = new Anthropic({ apiKey });
    return { classify: (input) => classifyItem(input, { anthropic }), mode: "live" };
  }
  return { classify: async (input) => classifyOffline(input), mode: "offline" };
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
    const anthropic = new Anthropic({ apiKey });
    return { parse: (d) => parseTripConditions(d, { anthropic }), mode: "live" };
  }
  return { parse: async (d) => parseConditionsHeuristic(d), mode: "offline" };
}
