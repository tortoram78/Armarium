// The URL-shape SSRF gate for manufacturer-URL enrichment (Phase 3 step 2).
//
// PURE string/URL logic only — there is NO DNS resolution or socket logic here (that, and the
// private-IP / DNS-rebinding checks, belong to the SEPARATE server-layer fetcher). This gate enforces
// the *shape* of a permissible manufacturer URL: https-only, host on a small curated allowlist, no
// embedded credentials, no explicit non-default port, and no IP-literal host. Those last three are
// classic SSRF vectors that have no legitimate place in a manufacturer allowlist.
//
// The allowlist IS the security boundary: an HTML string only earns `source:"manufacturer"` because
// its URL cleared this gate. Keep it small and curated; add domains deliberately.

/**
 * Starter manufacturer allowlist — registrable domains of cooperative outdoor manufacturers/retailers
 * that publish schema.org Product / OpenGraph data. THIS IS THE SECURITY BOUNDARY: only hosts that are
 * exactly one of these, or a subdomain of one of these, may be enriched. Extend deliberately.
 */
export const MANUFACTURER_ALLOWLIST: readonly string[] = [
  "patagonia.com",
  "arcteryx.com",
  "rei.com",
  "thenorthface.com",
  "blackdiamondequipment.com",
  "marmot.com",
] as const;

export type ValidateEnrichUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** IPv4 dotted-quad literal, e.g. "169.254.169.254" (a classic SSRF metadata target). */
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * True if `host` is an IP literal (v4 or v6). IPv6 literals arrive bracketed in a URL host
 * (`[::1]`); the WHATWG URL parser strips the brackets in `.hostname`, so we also detect the
 * un-bracketed colon form here. Manufacturer hosts are always registered domain names, never IPs.
 */
function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 (bracketed or raw)
  if (IPV4_RE.test(host)) return true; // IPv4 dotted-quad
  return false;
}

/**
 * Normalize an allowlist entry / hostname for comparison: lowercase and strip any trailing dot
 * (the DNS root label). Hostnames are case-insensitive.
 */
function normHost(h: string): string {
  let s = h.toLowerCase();
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

/**
 * Host matches the allowlist iff it is EXACTLY an allowed registrable domain, or a true subdomain of
 * one (i.e. it ends with `"." + allowed`). This is a label-boundary suffix match — it deliberately
 * rejects the classic suffix-spoof `patagonia.com.evil.com`, because that host neither equals
 * `patagonia.com` nor ends with `.patagonia.com` (it ends with `.evil.com`). A bare `evilpatagonia.com`
 * is likewise rejected since it does not end with the dotted form.
 */
function hostMatchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  const h = normHost(host);
  for (const raw of allowlist) {
    const allowed = normHost(raw);
    if (!allowed) continue;
    if (h === allowed) return true;
    if (h.endsWith("." + allowed)) return true;
  }
  return false;
}

/**
 * The URL-shape SSRF gate. Returns the normalized URL string on success, or a reason on rejection.
 * NEVER throws on arbitrary input (a non-parseable URL is a clean `{ ok: false }`).
 */
export function validateEnrichUrl(
  rawUrl: string,
  allowlist: readonly string[] = MANUFACTURER_ALLOWLIST,
): ValidateEnrichUrlResult {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    return { ok: false, reason: "empty or non-string URL" };
  }

  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not a parseable absolute URL" };
  }

  // https only — http/file/data/ftp/javascript/etc. are all rejected.
  if (u.protocol !== "https:") {
    return { ok: false, reason: `scheme must be https:, got ${u.protocol}` };
  }

  // No embedded credentials (user:pass@host) — a known SSRF/credential-leak vector.
  if (u.username !== "" || u.password !== "") {
    return { ok: false, reason: "embedded credentials are not allowed" };
  }

  // No explicit port. WHATWG URL leaves `.port` empty when the port equals the scheme default (443),
  // so any non-empty `.port` here is an explicit, non-default port.
  if (u.port !== "") {
    return { ok: false, reason: `non-default port is not allowed: ${u.port}` };
  }

  const host = u.hostname;
  if (host === "") {
    return { ok: false, reason: "missing host" };
  }

  // No IP-literal hosts — manufacturer hosts are domain names; IP literals are an SSRF vector.
  if (isIpLiteral(host)) {
    return { ok: false, reason: "IP-literal hosts are not allowed" };
  }

  if (!hostMatchesAllowlist(host, allowlist)) {
    return { ok: false, reason: `host not on manufacturer allowlist: ${host}` };
  }

  return { ok: true, url: u.toString() };
}
