// SSRF-safe server-side fetcher for manufacturer-URL enrichment (Phase 3 step 2).
//
// SECURITY-CRITICAL. This is the network half the pure core (`src/core/enrich`) deliberately omits.
// The core's `validateEnrichUrl` proves a URL has the *shape* of an allowlisted manufacturer URL
// (https-only, allowlisted host, no creds / explicit port / IP-literal). That is necessary but not
// sufficient: a perfectly-shaped host can still RESOLVE to an internal address (DNS rebinding, hostile
// or misconfigured DNS), or the server can REDIRECT us to one (302 → http://169.254.169.254/). So this
// layer adds, on top of the shape gate, the defenses that need DNS + the live response:
//
//   1. shape gate (delegate to core) on the initial URL and on every redirect Location;
//   2. DNS resolution to ALL A/AAAA addresses + a private/loopback/link-local/reserved-IP block,
//      re-run on every hop (so a host that passes the gate then rebinds/redirects internal is caught);
//   3. transport limits: https only, hard timeout, streamed body capped at maxBytes, HTML-ish
//      content-type required.
//
// Everything is INJECTABLE (`fetch`, the DNS `lookup`) so the SSRF behavior is provable hermetically
// with fakes — the sandbox (and CI) have no real network.
//
// HONEST LIMITATION (flagged for re-audit): with the stock `globalThis.fetch` we cannot pin the
// connection to the exact IP we vetted, so a TOCTOU window exists between our DNS check and fetch's own
// resolution. The per-hop re-validation here is the primary, testable defense; closing the residual
// TOCTOU fully requires a pinned-IP dispatcher (undici) and is noted in the return for follow-up.

import { resolve4, resolve6 } from "node:dns/promises";
import { validateEnrichUrl, MANUFACTURER_ALLOWLIST } from "@/core/enrich";
import { allAddressesPublic, isBlockedAddress } from "./ip-guard";

export type FetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: string };

export interface FetcherDeps {
  /** Defaults to the real `globalThis.fetch`. Injected so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /** Resolve a hostname to ALL of its A/AAAA addresses. Defaults to a `node:dns/promises` lookup. */
  lookup?: (host: string) => Promise<string[]>;
  /** Max body bytes before the stream is aborted. Default ~2 MB. */
  maxBytes?: number;
  /** Hard per-request timeout (ms) via AbortController. Default 8000. */
  timeoutMs?: number;
  /** Max redirect hops to follow (each re-validated). Default 3. */
  maxRedirects?: number;
  /** Allowlist passed through to the core shape gate. Defaults to MANUFACTURER_ALLOWLIST. */
  allowlist?: readonly string[];
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REDIRECTS = 3;

const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

/**
 * Default DNS lookup: resolve BOTH A and AAAA records and return every address. We want all of them —
 * blocking must consider the whole set (a host that returns one public and one loopback address is
 * still dangerous). `resolve4`/`resolve6` reject if there are no records of that family; we swallow
 * those per-family so a v4-only or v6-only host still works, but if BOTH fail we surface empty (which
 * the IP guard treats as "no safe address" → blocked).
 */
async function defaultLookup(host: string): Promise<string[]> {
  const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
  const addrs: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") addrs.push(...r.value);
  }
  return addrs;
}

/** Shape gate (core) + DNS-resolve-all + private-IP block for a single URL. Returns ok or a reason. */
async function validateHop(
  rawUrl: string,
  lookup: (host: string) => Promise<string[]>,
  allowlist: readonly string[],
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  // 1. Shape gate — https-only, allowlisted host, no creds/port/IP-literal. (Pure core.)
  const shape = validateEnrichUrl(rawUrl, allowlist);
  if (!shape.ok) return { ok: false, reason: `url-shape: ${shape.reason}` };

  const url = new URL(shape.url);

  // 2. DNS — resolve to ALL addresses, then block if ANY is private/loopback/link-local/reserved.
  let addrs: string[];
  try {
    addrs = await lookup(url.hostname);
  } catch (err) {
    return { ok: false, reason: `dns: lookup failed for ${url.hostname}: ${errMsg(err)}` };
  }
  if (addrs.length === 0) {
    return { ok: false, reason: `dns: no addresses resolved for ${url.hostname}` };
  }
  for (const a of addrs) {
    if (isBlockedAddress(a)) {
      return { ok: false, reason: `private-ip: ${url.hostname} resolves to blocked address ${a}` };
    }
  }
  // Belt-and-suspenders: assert the whole set is public (also catches the empty case).
  if (!allAddressesPublic(addrs)) {
    return { ok: false, reason: `private-ip: ${url.hostname} resolved a non-public address` };
  }

  return { ok: true, url };
}

/**
 * Fetch the HTML at a manufacturer URL with layered SSRF defenses. NEVER throws — every failure
 * (gate rejection, blocked IP, redirect-to-internal, too many redirects, oversize body, wrong
 * content-type, timeout/abort, network error) is returned as `{ ok:false, reason }`.
 */
export async function fetchManufacturerHtml(
  rawUrl: string,
  deps: FetcherDeps = {},
): Promise<FetchResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowlist = deps.allowlist ?? MANUFACTURER_ALLOWLIST;

  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "no fetch implementation available" };
  }

  let currentUrl = rawUrl;
  let redirectsFollowed = 0;

  // Redirect loop. Each iteration re-validates (shape + DNS/private-IP) BEFORE issuing the request,
  // so a host that 302s to an internal target is caught on the next pass — never followed blindly.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const validated = await validateHop(currentUrl, lookup, allowlist);
    if (!validated.ok) return { ok: false, reason: validated.reason };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(validated.url.toString(), {
        method: "GET",
        redirect: "manual", // we follow redirects ourselves so we can re-validate every hop
        signal: controller.signal,
        headers: { accept: "text/html,application/xhtml+xml" },
      });
    } catch (err) {
      clearTimeout(timer);
      if (isAbortError(err)) return { ok: false, reason: "timeout: request aborted" };
      return { ok: false, reason: `network: ${errMsg(err)}` };
    }

    // Handle redirects ourselves.
    if (isRedirectStatus(response.status)) {
      clearTimeout(timer);
      await drainQuietly(response);

      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, reason: `redirect: ${response.status} with no Location header` };
      }
      if (redirectsFollowed >= maxRedirects) {
        return { ok: false, reason: `redirect: exceeded max redirects (${maxRedirects})` };
      }

      // Resolve relative Location against the current URL, then loop to re-validate it.
      let nextUrl: string;
      try {
        nextUrl = new URL(location, validated.url).toString();
      } catch {
        return { ok: false, reason: `redirect: unparseable Location ${location}` };
      }
      redirectsFollowed += 1;
      currentUrl = nextUrl;
      continue;
    }

    // Non-redirect: this is the final response.
    try {
      if (response.status < 200 || response.status >= 300) {
        await drainQuietly(response);
        return { ok: false, reason: `http: non-2xx status ${response.status}` };
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!isHtmlContentType(contentType)) {
        await drainQuietly(response);
        return { ok: false, reason: `content-type: not HTML (${contentType || "missing"})` };
      }

      const bodyResult = await readCapped(response, maxBytes);
      if (!bodyResult.ok) return { ok: false, reason: bodyResult.reason };

      return { ok: true, html: bodyResult.html, finalUrl: validated.url.toString() };
    } catch (err) {
      if (isAbortError(err)) return { ok: false, reason: "timeout: request aborted" };
      return { ok: false, reason: `read: ${errMsg(err)}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Stream the body and abort once `maxBytes` is exceeded — never buffer unboundedly. Returns the
 * decoded HTML truncated to the cap. Falls back to a capped `.text()` read if the body is not a
 * web ReadableStream (some fetch implementations / fakes return a string-backed body).
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  const body = response.body;

  // Streaming path: read chunk-by-chunk, abort the moment we cross the cap.
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel("maxBytes exceeded").catch(() => {});
            return { ok: false, reason: `size: body exceeds maxBytes (${maxBytes})` };
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      if (isAbortError(err)) return { ok: false, reason: "timeout: request aborted" };
      return { ok: false, reason: `read: ${errMsg(err)}` };
    }
    const merged = concatChunks(chunks, total);
    const html = new TextDecoder("utf-8").decode(merged);
    return { ok: true, html: truncate(html, maxBytes) };
  }

  // Fallback: read text and enforce the cap on the decoded length. We measure UTF-8 byte length so the
  // limit is genuinely a byte limit, not a code-unit limit.
  const text = await response.text();
  const byteLen = utf8ByteLength(text);
  if (byteLen > maxBytes) {
    return { ok: false, reason: `size: body exceeds maxBytes (${maxBytes})` };
  }
  return { ok: true, html: text };
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Truncate so the result never exceeds `maxBytes` UTF-8 bytes (cheap char-based guard, then verify). */
function truncate(s: string, maxBytes: number): string {
  if (utf8ByteLength(s) <= maxBytes) return s;
  // Each char is at most 4 UTF-8 bytes; slicing to maxBytes chars is a safe over-approximation, then
  // trim down if still over.
  let out = s.slice(0, maxBytes);
  while (utf8ByteLength(out) > maxBytes && out.length > 0) {
    out = out.slice(0, out.length - 1);
  }
  return out;
}

function utf8ByteLength(s: string): number {
  // TextEncoder is available in Node 18+ and the edge runtime.
  return new TextEncoder().encode(s).length;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isHtmlContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  // content-type may carry a charset etc.: "text/html; charset=utf-8".
  const mime = lower.split(";")[0]?.trim() ?? "";
  return HTML_CONTENT_TYPES.includes(mime);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === "AbortError" || err.message === "timeout" || /abort/i.test(err.message);
  }
  return false;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Best-effort drain so a non-final / error response doesn't leak the connection. Never throws. */
async function drainQuietly(response: Response): Promise<void> {
  try {
    const body = response.body as ReadableStream<Uint8Array> | null;
    if (body && typeof body.cancel === "function") {
      await body.cancel().catch(() => {});
      return;
    }
    // No stream — read and discard.
    await response.arrayBuffer().catch(() => {});
  } catch {
    /* ignore */
  }
}

// Re-export the IP guard so tests (and future callers) can exercise the boundary table directly.
export { isBlockedIp, isBlockedAddress, parseIp, allAddressesPublic } from "./ip-guard";
