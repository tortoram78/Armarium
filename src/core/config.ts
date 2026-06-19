// Framework-agnostic core config. Pure constants only — no env reads, no Next/DB imports
// (load-bearing rule #3: src/core stays pure and receives its dependencies).

/** The ONE Anthropic model id for the whole app (load-bearing rule #5). Swappable here only. */
export const MODEL_ID = "claude-sonnet-4-6" as const;

/** Token budget for a single classification call. */
export const CLASSIFY_MAX_TOKENS = 4096;
