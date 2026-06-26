// Seed script — populates the Postgres database with the prototype gear corpus.
// Requires DATABASE_URL. Optionally uses ANTHROPIC_API_KEY to run the real classification pipeline;
// falls back to the pre-validated SEED_CORPUS when no API key is present.
//
// Usage:
//   DATABASE_URL=postgres://... ANTHROPIC_API_KEY=sk-ant-... pnpm db:seed
//   DATABASE_URL=postgres://... pnpm db:seed   # uses offline corpus (no LLM calls)
//
// Safety: this guard at the top aborts immediately if DATABASE_URL is not set so the script can
// never accidentally corrupt a dev environment that omits the variable.

// Env is provided by the shell or platform (Vercel/CI), e.g.:
//   DATABASE_URL=postgres://... ANTHROPIC_API_KEY=sk-ant-... pnpm db:seed
// (No dotenv dependency: pass the vars inline, or `node --env-file=.env.local` on Node >= 20.6.)

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Seed only runs against a real Postgres database.");
  process.exit(1);
}

import { createDb } from "../src/db/client";
import { items as itemsTable } from "../src/db/schema";
import { SEED_CORPUS } from "../src/core/seed-corpus";
import type { SeedEntry } from "../src/core/seed-corpus";
import { postgresRepository } from "../src/server/postgres-repo";
import { postgresCache } from "../src/server/postgres-cache";
import { normalizeCacheKey } from "../src/core/cache";

const USER_ID = process.env.ARMARIUM_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const db = createDb(process.env.DATABASE_URL!);

async function seedEntry(entry: SeedEntry): Promise<void> {
  let classification = entry.classification;

  // When ANTHROPIC_API_KEY is set, run the real pipeline to get a fresh classification;
  // otherwise use the pre-validated corpus classification as-is.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const { classifyItem } = await import("../src/core/classify/classify");
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      classification = await classifyItem({ name: entry.input.name, text: entry.input.text }, { anthropic });
      console.log(`  [live] classified: ${entry.input.name}`);
    } catch (err) {
      console.warn(`  [live] classification failed for "${entry.input.name}", falling back to corpus:`, err);
    }
  } else {
    console.log(`  [offline] using corpus: ${entry.input.name}`);
  }

  await postgresRepository.addItem(USER_ID, {
    name: classification.name,
    inInventory: entry.inInventory,
    draft: false,
    rawText: entry.input.text,
    classification,
    // All seed corpus items are real gear (apparel, sleeping bags, etc.) — tag them so the
    // isGearClassified predicate and domain-aware UI can distinguish them from non-gear records.
    // A future non-gear seed entry should explicitly set domains: [] here.
    inventory: { domains: ["gear"] },
  });
}

async function main() {
  console.log(`Seeding ${SEED_CORPUS.length} items for user ${USER_ID} …`);

  // Check for existing items to avoid double-seeding
  const existing = await db.select({ id: itemsTable.id }).from(itemsTable).limit(1);
  if (existing.length > 0) {
    console.log("Database already contains items — skipping seed to avoid duplicates.");
    console.log("To re-seed, truncate the items table first.");
    process.exit(0);
  }

  let success = 0;
  let failures = 0;

  for (const entry of SEED_CORPUS) {
    try {
      await seedEntry(entry);
      success++;
    } catch (err) {
      console.error(`  ERROR seeding "${entry.input.name}":`, err);
      failures++;
    }
  }

  console.log(`\nDone: ${success} seeded, ${failures} failed.`);

  // Populate the GLOBAL draft cache from the seed corpus so repeat adds skip the LLM immediately.
  // Seed entries are low-authority DRAFTS (ADR-0012 Element 5) — shared, never a per-user override.
  console.log("\nPopulating classification draft cache …");
  let cacheSuccess = 0;
  let cacheFailures = 0;
  for (const entry of SEED_CORPUS) {
    try {
      await postgresCache.putDraft(
        normalizeCacheKey(entry.classification.name),
        entry.classification.name,
        entry.classification,
        null,
        "seed",
      );
      cacheSuccess++;
    } catch (err) {
      console.error(`  ERROR caching "${entry.classification.name}":`, err);
      cacheFailures++;
    }
  }
  console.log(`Cache: ${cacheSuccess} upserted, ${cacheFailures} failed.`);

  if (failures > 0 || cacheFailures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Seed script fatal error:", err);
  process.exit(1);
});
