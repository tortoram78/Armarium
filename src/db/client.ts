// Lazy, injected DB client. Constructed only when called (never at import/build time), so `next build`
// and the test/typecheck gates never need a DATABASE_URL. Lives outside src/core to keep the core pure.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const sql = postgres(databaseUrl, { prepare: false });
  return drizzle(sql, { schema });
}
