// Lazy, injected DB client. Constructed only when called (never at import/build time), so `next build`
// and the test/typecheck gates never need a DATABASE_URL. Lives outside src/core to keep the core pure.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  // Serverless-safe pool: the Supabase pooler multiplexes, so cap at one
  // connection per lambda instance, release idle ones quickly, and — critically —
  // fail fast (connect_timeout) instead of hanging forever when the pool is
  // saturated. A saturated pool with no connect_timeout was blocking every
  // DB-backed route (the "add item locks up the whole website" bug).
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}
