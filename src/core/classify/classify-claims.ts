// The live CLAIMS classification call (Phase 3 — ADR-0014 §2). Pure core: it receives an Anthropic client
// (never constructs one, never reads env), so it stays framework-agnostic and testable with a mock. The
// model emits a flat CLAIMS object; the output is Zod-validated by `LlmClaimsSchema` before it is returned
// — unvalidated model text never escapes this function. Resolution into an `ItemClassification` happens
// downstream, in the assembler.

import type Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID, CLASSIFY_MAX_TOKENS } from "../config";
import { toLlmUsage, type LlmUsage } from "../obs/log";
import { safeParseLlmClaims, type LlmClaimsOutput } from "./claims";
import { buildClassifyPrompt, type ClassifyInput } from "./prompt";

export interface ClassifyDeps {
  anthropic: Anthropic;
  model?: string;
  /**
   * Optional usage sink. When set, it is invoked once per LLM call with the model + token counts so the
   * server can log/meter spend WITHOUT core importing a console. Core never logs; it only reports. The
   * offline/mock paths never construct this dep (no usage to report), so absent usage is the clean default.
   */
  onUsage?: (usage: LlmUsage) => void;
}

export class ClaimsClassificationError extends Error {}

export async function classifyItemClaims(input: ClassifyInput, deps: ClassifyDeps): Promise<LlmClaimsOutput> {
  const { system, user } = buildClassifyPrompt(input);
  const model = deps.model ?? MODEL_ID;
  const msg = await deps.anthropic.messages.create({
    model,
    max_tokens: CLASSIFY_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });
  deps.onUsage?.(toLlmUsage(model, msg.usage));

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = extractJson(text);
  const parsed = safeParseLlmClaims(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ClaimsClassificationError(`Claims classification failed validation: ${issues}`);
  }
  // Force the user-provided name (the model occasionally rewrites it).
  return { ...parsed.data, name: input.name };
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ClaimsClassificationError("No JSON object found in model output.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ClaimsClassificationError("Model output was not valid JSON.");
  }
}
