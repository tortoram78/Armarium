// Composition root (edge): selects the repository and classifier from the environment, so the rest of
// the app (route handlers, server actions, pages) depends only on these factories. Reads env HERE, not
// in core.

import Anthropic from "@anthropic-ai/sdk";
import type { GearRepository } from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { ClassifyInput } from "@/core/classify/prompt";
import { classifyItem } from "@/core/classify/classify";
import { classifyOffline } from "@/core/classify/offline";
import { memoryRepository } from "./memory-repo";

/** v0 single fixed user (one-password gate; no real auth). */
export const DEFAULT_USER_ID = process.env.ARMARIUM_USER_ID ?? "00000000-0000-0000-0000-000000000001";

let repo: GearRepository | null = null;

/** Postgres repo is wired when DATABASE_URL is set; in-memory otherwise (always runnable). */
export function getRepository(): GearRepository {
  if (repo) return repo;
  // TODO(persistence): return a Drizzle/Postgres repository when process.env.DATABASE_URL is set.
  repo = memoryRepository;
  return repo;
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
