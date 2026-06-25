// Residential-proxy fallback fetcher for manufacturer-URL enrichment (Scrapfly).
//
// WHY THIS EXISTS: several allowlisted manufacturers (REI, The North Face) sit behind Akamai/WAF bot
// management that blocks our datacenter/serverless IP outright — the direct `fetchManufacturerHtml`
// (enrich-fetcher.ts) comes back with a 200 bot-challenge page (no product data), a 403, or a refused
// connection. Scrapfly's `asp` (anti-scraping protection) + residential pool solves the challenge from a
// real residential IP and returns the true server-rendered HTML, which the SAME parser then reads.
// (Verified: REI + TNF clear the wall; Patagonia's Akamai config does NOT — even residential fails — so
// it falls through to the honest no-signal path. Residential IS the premium tier, so paying wouldn't fix
// Patagonia.) Used ONLY as a fallback after a direct fetch yields no signal — non-walled brands never
// spend a credit. Off entirely unless `SCRAPFLY_KEY` is set (graceful: no key → exactly today's behavior).
//
// SECURITY: the SAME core shape gate (`validateEnrichUrl`) runs here too — we ONLY ever hand an
// allowlisted manufacturer URL to the third party; an arbitrary/internal URL is never proxied. The SSRF
// DNS/private-IP defenses in enrich-fetcher are moot here (Scrapfly, not us, connects to the target), and
// the allowlist confines the target to known-public manufacturer hosts. The endpoint URL carries the API
// key — it must NEVER be logged.

import { validateEnrichUrl, MANUFACTURER_ALLOWLIST } from "@/core/enrich";
import type { FetchResult } from "./enrich-fetcher";

const SCRAPFLY_ENDPOINT = "https://api.scrapfly.io/scrape";
// Residential + a real browser is slow (challenge solving + render). Generous ceiling; the caller only
// reaches this on the walled-brand fallback path, never on the common direct-fetch happy path.
const DEFAULT_TIMEOUT_MS = 150_000;

export interface ScrapflyDeps {
  /** Defaults to `globalThis.fetch`. Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Hard per-request timeout (ms). Default 150s (residential + render is slow). */
  timeoutMs?: number;
  /** Allowlist passed to the core shape gate. Defaults to MANUFACTURER_ALLOWLIST. */
  allowlist?: readonly string[];
  /** Overrides the API key (defaults to `process.env.SCRAPFLY_KEY`). */
  apiKey?: string;
}

/** True when the Scrapfly fallback is configured (server-only `SCRAPFLY_KEY`). */
export function isScrapflyConfigured(): boolean {
  return Boolean(process.env.SCRAPFLY_KEY);
}

/**
 * Fetch an allowlisted manufacturer URL through Scrapfly's residential + anti-bot pipeline. Returns the
 * same `FetchResult` shape as the direct fetcher, so the caller parses the HTML identically. NEVER throws.
 * A Scrapfly-level failure (bad key, timeout, error envelope) returns `{ ok:false, reason:"scrapfly: …" }`;
 * a successful fetch of a still-blocked page (e.g. Patagonia) returns the challenge HTML as `ok:true` and
 * the downstream no-signal guard handles it honestly.
 */
export async function fetchViaScrapfly(rawUrl: string, deps: ScrapflyDeps = {}): Promise<FetchResult> {
  const apiKey = deps.apiKey ?? process.env.SCRAPFLY_KEY;
  if (!apiKey) return { ok: false, reason: "scrapfly: not configured" };

  const allowlist = deps.allowlist ?? MANUFACTURER_ALLOWLIST;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== "function") return { ok: false, reason: "scrapfly: no fetch implementation" };

  // SHAPE GATE — only ever proxy an allowlisted, well-formed manufacturer URL through the third party.
  const shape = validateEnrichUrl(rawUrl, allowlist);
  if (!shape.ok) return { ok: false, reason: `url-shape: ${shape.reason}` };

  // asp=true (solve the anti-bot challenge) + residential pool (real IP) + render_js (run the JS sensor
  // Akamai needs) + a US exit. URLSearchParams encodes the target URL safely. Endpoint carries the key →
  // never log it.
  const params = new URLSearchParams({
    key: apiKey,
    url: shape.url,
    asp: "true",
    render_js: "true",
    proxy_pool: "public_residential_pool",
    country: "us",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${SCRAPFLY_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, reason: isAbortError(err) ? "scrapfly: timeout" : `scrapfly: network ${errMsg(err)}` };
  }
  clearTimeout(timer);

  if (!response.ok) return { ok: false, reason: `scrapfly: http ${response.status}` };

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    return { ok: false, reason: `scrapfly: invalid json ${errMsg(err)}` };
  }

  // Scrapfly wraps the fetched page in `{ result: { content, status_code, url, … } }`.
  const result = (data as { result?: { content?: unknown; url?: unknown } } | null)?.result;
  const content = typeof result?.content === "string" ? result.content : null;
  if (!content) return { ok: false, reason: "scrapfly: empty content" };

  const finalUrl = typeof result?.url === "string" ? result.url : shape.url;
  return { ok: true, html: content, finalUrl };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /abort|timeout/i.test(err.message));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
