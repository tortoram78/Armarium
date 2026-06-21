#!/usr/bin/env node
/**
 * Apply Drizzle migrations to Supabase via the Management API (HTTPS).
 *
 * Why this exists: Claude Code's cloud sandbox routes all egress through an
 * HTTP/HTTPS proxy, so the raw Postgres port (5432/6543) is unreachable and
 * `drizzle-kit migrate` cannot connect. The Supabase Management API runs SQL
 * over 443, so we drive migrations through it instead. Applied migrations are
 * recorded in drizzle.__drizzle_migrations exactly as drizzle-kit would, so a
 * normal `drizzle-kit migrate` from a DB-connected environment stays in sync.
 *
 * Each migration is applied in a single transaction (statements + the tracking
 * row), so a partial failure rolls back and re-running is safe.
 *
 * Requires env: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN.
 * Usage: node scripts/db-mgmt-migrate.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!REF || !TOKEN) {
  console.error('Missing SUPABASE_PROJECT_REF and/or SUPABASE_ACCESS_TOKEN in env.');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRIZZLE_DIR = join(ROOT, 'drizzle');
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function runSql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'));

// Ensure the tracking table exists (mirrors drizzle-orm's pg migrator).
await runSql(
  'CREATE SCHEMA IF NOT EXISTS "drizzle";' +
    'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (' +
    'id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);',
);

const rows = await runSql('SELECT created_at FROM "drizzle"."__drizzle_migrations";');
const applied = new Set((rows ?? []).map((r) => String(r.created_at)));

let count = 0;
for (const entry of journal.entries) {
  const when = String(entry.when);
  if (applied.has(when)) {
    console.log(`skip   ${entry.tag}`);
    continue;
  }
  const sql = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(';') ? s : `${s};`));
  const tx = [
    'BEGIN;',
    ...statements,
    `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ('${hash}', ${when});`,
    'COMMIT;',
  ].join('\n');
  process.stdout.write(`apply  ${entry.tag} ... `);
  await runSql(tx);
  console.log('ok');
  count++;
}
console.log(`\n${count} migration(s) applied, ${applied.size} already present.`);
