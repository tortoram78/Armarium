// The live classification call. Pure core: it receives an Anthropic client (never constructs one,
// never reads env), so it stays framework-agnostic and testable with a mock. Output is Zod-validated
// before it is returned — unvalidated model text never escapes this function.

import type Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID, CLASSIFY_MAX_TOKENS } from "../config";
import { safeParseClassification, type ItemClassification } from "../classification";
import { buildClassifyPrompt, type ClassifyInput } from "./prompt";

export interface ClassifyDeps {
  anthropic: Anthropic;
  model?: string;
}

export class ClassificationError extends Error {}

export async function classifyItem(input: ClassifyInput, deps: ClassifyDeps): Promise<ItemClassification> {
  const { system, user } = buildClassifyPrompt(input);
  const msg = await deps.anthropic.messages.create({
    model: deps.model ?? MODEL_ID,
    max_tokens: CLASSIFY_MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = extractJson(text);
  const parsed = safeParseClassification(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ClassificationError(`Classification failed validation: ${issues}`);
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
    throw new ClassificationError("No JSON object found in model output.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ClassificationError("Model output was not valid JSON.");
  }
}
