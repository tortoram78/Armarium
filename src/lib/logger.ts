// The SERVER logger (ops-hardening wave B1). This is the ONE place a console sink is allowed: it wraps the
// pure `formatLogLine` contract (src/core/obs/log.ts) with `console.log`/`console.error` and stamps a
// timestamp + the runtime environment. Core stays sink-free (no console, no env, no time); the time +
// console live here so the framework-agnostic core can be reused (MCP server, tests) without a logger.
//
// Edge/runtime-safe: the only side effect is `console.*` and `Date.now()` — NO Node-only APIs (no fs,
// no process.stdout.write), so this is safe in the Edge runtime and in a server action alike.

import { formatLogLine, type LogEvent } from "@/core/obs/log";

// Stamped on every line so logs are queryable by deploy environment without the caller passing it. Read at
// MODULE LOAD (not per-call) — these are build/deploy constants, and reading them here keeps core env-free.
// `??` so an absent NODE_ENV/NEXT_RUNTIME degrades to a stable placeholder rather than "undefined".
const ENV = process.env.NODE_ENV ?? "development";
const RUNTIME = process.env.NEXT_RUNTIME ?? "nodejs";

/**
 * Format `event` via the pure contract, stamp `ts`/`env`/`runtime`, and write ONE JSON line to console.
 * `level: "error"` routes to `console.error`; everything else to `console.log`. This is the only console
 * call site in the server logging path — every other module reports through `logEvent`/`timeAndLog`.
 */
export function logEvent(event: LogEvent): void {
  // formatLogLine owns the stable key order of the core fields; we prepend the server-only stamp as its
  // own JSON object so a log processor sees `{ts,env,runtime} <core json>` on one line, both valid JSON.
  const stamp = JSON.stringify({ ts: new Date().toISOString(), env: ENV, runtime: RUNTIME });
  const line = `${stamp} ${formatLogLine(event)}`;
  if (event.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** Metadata for a `timeAndLog` span — the stable machine `event` key + the user-facing `action`. */
export interface TimeAndLogMeta {
  event: string;
  action: string;
  userId?: string;
}

/**
 * Time `fn` with `Date.now()` and emit one structured line for the outcome:
 *   - success → `{ ...meta, ok: true, durationMs }` at info level, returns the value.
 *   - throw   → `{ ...meta, ok: false, reason, durationMs }` at ERROR level, then RE-THROWS (never swallows).
 * `reason` is the thrown error's message (or its string form for a non-Error throw). Edge-safe: only
 * `Date.now()` + console via `logEvent`.
 */
export async function timeAndLog<T>(meta: TimeAndLogMeta, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEvent({ level: "info", event: meta.event, action: meta.action, userId: meta.userId, ok: true, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logEvent({ level: "error", event: meta.event, action: meta.action, userId: meta.userId, ok: false, reason, durationMs: Date.now() - start });
    throw err;
  }
}
