// Shared lazy DB singleton for server-side Postgres access.
// This module is safe to import with no DATABASE_URL: `getDb()` throws only on first call (i.e., on
// the first query), never at module load. Importing this file has ZERO connection side effects.
//
// All server-side Drizzle repos (postgres-repo, postgres-cache) import `getDb` from here so there is
// exactly ONE connection pool in the process regardless of how many repos are instantiated.

import { createDb, type Db } from "@/db/client";

let _db: Db | null = null;

/**
 * Returns the lazy singleton Drizzle client. Throws if DATABASE_URL is not set — but only on the
 * first actual call, not at import time, so build/test/typecheck are always green.
 */
export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — cannot use the Postgres repository. " +
        "Set DATABASE_URL in your environment or use the in-memory repository."
    );
  }
  _db = createDb(url);
  return _db;
}
