// The pure structured-log record contract (ops-hardening bundle). This is the SINGLE SOURCE OF TRUTH for
// the shape of an operational log line. It is intentionally free of any sink: NO console, NO env, NO
// timestamps, NO i/o. The server logger (next wave) wraps `formatLogLine` with `console` as the sink and
// stamps the time; core only defines the record and serializes it to one stable JSON line.

/** LLM token accounting for a single model call, surfaced from the classify/parse paths for logging. */
export interface LlmUsage {
  /** The resolved model id the call ran against. */
  model: string;
  /** Prompt tokens. The SDK reports this as possibly null; we normalize a missing count to 0 at the edge. */
  inputTokens: number;
  /** Completion tokens. */
  outputTokens: number;
}

/** The raw token-count shape an Anthropic message carries on `.usage`. Both fields may be absent on a mock. */
export interface RawTokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
}

/**
 * Normalize a raw Anthropic `usage` block (or a mock's missing one) into the stable `LlmUsage` shape. A
 * null/undefined count becomes 0, so the offline/mock-no-usage path reports zero cleanly rather than NaN.
 * Pure — the single place token counts are coerced.
 */
export function toLlmUsage(model: string, usage: RawTokenUsage | null | undefined): LlmUsage {
  return {
    model,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

export type LogLevel = "info" | "warn" | "error";

/**
 * One operational event. `event` is a stable machine key (e.g. "classify", "ratelimit.deny"); the optional
 * fields are present only when meaningful for that event. `llm` is included only for model-backed calls.
 * Keep this in sync with the server logger and any log-querying — it is the one definition of the shape.
 */
export interface LogEvent {
  level: LogLevel;
  event: string;
  action?: string;
  userId?: string;
  ok?: boolean;
  reason?: string;
  durationMs?: number;
  llm?: LlmUsage;
}

// The serialization key order. A fixed order makes log lines diff-stable and grep-predictable across runs.
const KEY_ORDER: (keyof LogEvent)[] = [
  "level",
  "event",
  "action",
  "userId",
  "ok",
  "reason",
  "durationMs",
  "llm",
];

/**
 * Serialize a `LogEvent` to ONE stable single-line JSON string. Only set fields are emitted (an absent
 * optional is omitted, never rendered as `null`), keys are written in a fixed order, and the result
 * round-trips through `JSON.parse`. Pure: no time, no env, no sink.
 */
export function formatLogLine(event: LogEvent): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = event[key];
    if (value !== undefined) ordered[key] = value;
  }
  return JSON.stringify(ordered);
}
