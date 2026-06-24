// URL codec for TripConditions — the demo-funnel bridge.
//
// The guest preview round-trips structured conditions through the URL: planPreviewAction encodes them into
// `/plan/preview?conditions=…`, the preview page decodes + re-runs the plan, and the save-wall carries the
// SAME encoded blob into `/login?next=/plan?conditions=…` so a returning user lands on a pre-filled form.
//
// A query string is UNTRUSTED input. `decodeConditions` Zod-validates against the bounded conditions schema
// (enum facets + nullable numbers) and returns null on anything malformed — a raw query value never reaches
// the planner or the form unchecked (Architecture rule #2: validated evidence only).

import { TripConditionsSchema, type TripConditions } from "@/core/conditions";

/** Encode conditions to a compact, URL-safe string (base64url of the JSON). */
export function encodeConditions(c: TripConditions): string {
  const json = JSON.stringify(c);
  // base64url so the value survives a query string without further percent-encoding noise.
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode + VALIDATE conditions from a URL value. Returns the parsed `TripConditions` or null if the value
 * is absent, not valid base64url/JSON, or fails the bounded Zod schema. Never throws.
 */
export function decodeConditions(raw: string | undefined | null): TripConditions | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = TripConditionsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
