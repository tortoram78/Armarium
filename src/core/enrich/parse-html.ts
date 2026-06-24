// Pure, dependency-free extraction of authoritative product specs from an already-fetched HTML string.
//
// NO new dependency, NO DOM, NO network: it scans the raw HTML for schema.org Product JSON-LD and, as a
// fallback, a handful of OpenGraph / product meta tags. Everything is best-effort and DEFENSIVE — on
// malformed JSON, missing fields, nested/multiple products, junk, or hostile input it returns whatever
// it could read and `null` for the rest. It MUST NEVER throw on arbitrary HTML.
//
// JSON-LD + OpenGraph is the deliberate v1 target: cooperative outdoor manufacturers (the allowlist)
// publish schema.org Product blocks, which is where the high-value composition/spec data lives. If a
// future source needed real DOM traversal, that is an ask-first dependency decision — not done here.

/** A single name/value spec lifted verbatim from `additionalProperty` (or an OG/meta tag). */
export interface ExtractedSpec {
  name: string;
  value: string;
}

/** A composition component parsed from a stated material/composition string (e.g. "100% recycled polyester"). */
export interface ExtractedFiber {
  fiber: string;
  pct: number | null;
  recycled: boolean;
}

/**
 * The raw, source-faithful product facts pulled out of one HTML page. Every field is nullable; a field
 * is non-null ONLY because the source literally stated it. This is intentionally a flat, lossless
 * carrier — mapping onto the validated classification shapes happens in `to-evidence.ts`.
 */
export interface ExtractedProduct {
  name: string | null;
  brand: string | null;
  sku: string | null;
  mpn: string | null;
  price_cents: number | null;
  price_currency: string | null;
  weight_grams: number | null;
  /** The raw stated material/composition string(s), source-verbatim (e.g. "100% recycled nylon"). */
  material_raw: string | null;
  /** Parsed composition components, when a percentage breakdown was stated. */
  fiber_components: ExtractedFiber[];
  /** Any additionalProperty name/value pairs, kept verbatim for downstream mapping/audit. */
  specs: ExtractedSpec[];
  /** Where the bulk of the data came from — for downstream confidence / debugging. */
  source: "json-ld" | "opengraph" | "none";
}

const EMPTY: ExtractedProduct = {
  name: null,
  brand: null,
  sku: null,
  mpn: null,
  price_cents: null,
  price_currency: null,
  weight_grams: null,
  material_raw: null,
  fiber_components: [],
  specs: [],
  source: "none",
};

// Bound the input we scan so a pathological multi-MB page can't blow up regex backtracking / memory.
const MAX_HTML = 4_000_000; // ~4 MB of HTML is far beyond any real product page.

/** Decode the small set of HTML entities that show up in extracted text. Never throws. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d{1,7});/g, (_m, d: string) => {
      const code = Number(d);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? safeFromCodePoint(code) : _m;
    })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_m, h: string) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? safeFromCodePoint(code) : _m;
    });
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string") {
      const t = decodeEntities(v).trim();
      if (t !== "") return t;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** A schema.org value may be a scalar, an object with `@value`/`name`, or an array — flatten to a string. */
function scalarOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return firstNonEmptyString(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = scalarOf(item);
      if (s) return s;
    }
    return null;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return firstNonEmptyString(o["@value"], o.name, o.value);
  }
  return null;
}

/** Parse a money string/number to integer cents. "$189.00", "189", 189 -> 18900. null on garbage. */
function toCents(v: unknown): number | null {
  if (v == null) return null;
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.]/g, "");
    if (cleaned === "" || cleaned === ".") return null;
    n = Number.parseFloat(cleaned);
  } else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Parse a stated weight to grams. Accepts a QuantitativeValue object ({ value, unitCode/unitText }) or a
 * plain string like "312 g" / "11 oz" / "0.69 kg" / "1.5 lb". Returns null when no unit/number is clear.
 */
function toGrams(v: unknown): number | null {
  let value: number | null = null;
  let unit: string | null = null;

  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const rawVal = o.value ?? o["@value"];
    if (typeof rawVal === "number") value = rawVal;
    else if (typeof rawVal === "string") {
      const f = Number.parseFloat(rawVal);
      if (Number.isFinite(f)) value = f;
    }
    unit = (scalarOf(o.unitCode) ?? scalarOf(o.unitText))?.toLowerCase() ?? null;
    // A bare QuantitativeValue with a value but no number-bearing string still needs a unit.
    if (value != null && unit) return convertToGrams(value, unit);
    // Fall through to string parsing of any embedded string value.
    if (value != null && !unit) return null; // unitless weight is not a usable hard fact
    v = scalarOf(o);
  }

  if (typeof v === "number") return null; // unitless number, cannot trust as grams
  if (typeof v !== "string") return null;

  const m = v.match(/(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds)\b/i);
  if (!m) return null;
  const num = Number.parseFloat(m[1]!);
  if (!Number.isFinite(num)) return null;
  return convertToGrams(num, m[2]!.toLowerCase());
}

function convertToGrams(num: number, unit: string): number | null {
  // Includes UN/CEFACT unit codes (GRM, KGM, ONZ, LBR) that show up in schema.org QuantitativeValue.
  switch (unit) {
    case "g": case "gram": case "grams": case "grm":
      return Math.round(num);
    case "kg": case "kilogram": case "kilograms": case "kgm":
      return Math.round(num * 1000);
    case "oz": case "ounce": case "ounces": case "onz":
      return Math.round(num * 28.3495);
    case "lb": case "lbs": case "pound": case "pounds": case "lbr":
      return Math.round(num * 453.592);
    default:
      return null;
  }
}

const FIBER_ALIASES: Record<string, string> = {
  poly: "polyester",
  polyamide: "nylon",
  "merino wool": "merino",
  wool: "wool",
  "organic cotton": "cotton",
  cotton: "cotton",
  spandex: "elastane",
  lycra: "elastane",
};

// Component/garment-part descriptor words that may trail a fiber name ("polyester shell", "nylon
// lining") — these name WHERE the fiber sits, not the fiber. We strip them to recover the bare fiber.
const DESCRIPTOR_WORDS =
  /\b(shell|lining|liner|body|face|backer|backing|trim|insert|inserts|panel|panels|mesh|fabric|material|main|exterior|interior|outer|inner|fill|filling|insulation|content)\b/gi;

function canonFiber(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Drop descriptor words and recycled/organic qualifiers before alias-canonicalizing.
  t = t.replace(DESCRIPTOR_WORDS, " ").replace(/\borganic\b/gi, " ").replace(/\s+/g, " ").trim();
  return FIBER_ALIASES[t] ?? t;
}

/**
 * Parse a stated composition string into fiber components. Handles the common forms:
 *   "100% recycled polyester"
 *   "55% hemp, 45% organic cotton"
 *   "60% nylon / 40% elastane"
 *   "100% recycled polyester shell, 60% recycled polyester / 40% nylon lining"  (descriptors stripped)
 * The "recycled" flag is detected per-component when the word appears adjacent to that fiber.
 * Returns [] when no percentage pattern is present (we do NOT guess a 100% from a bare material name).
 * Components with the same canonical fiber are merged by max percentage (so a fiber split across a
 * shell and a lining is reported once at its highest stated share).
 */
export function parseComposition(raw: string): ExtractedFiber[] {
  const collected: ExtractedFiber[] = [];
  const text = decodeEntities(raw);
  const re = /(\d{1,3}(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z\s/\-]*?)(?=(?:,|;|\/|\band\b|\d{1,3}(?:\.\d+)?\s*%|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const pct = Number.parseFloat(m[1]!);
    let label = m[2]!.trim().replace(/\s+/g, " ");
    if (label === "") continue;
    const recycled = /\brecycled\b/i.test(label);
    label = label.replace(/\brecycled\b/gi, "").trim();
    const fiber = canonFiber(label);
    if (fiber === "") continue;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    collected.push({ fiber, pct, recycled });
    if (collected.length >= 24) break; // sanity bound before dedup
  }

  // Merge duplicates by canonical fiber, keeping the highest stated percentage and OR-ing recycled.
  const byFiber = new Map<string, ExtractedFiber>();
  for (const c of collected) {
    const prev = byFiber.get(c.fiber);
    if (!prev) byFiber.set(c.fiber, { ...c });
    else {
      prev.pct = Math.max(prev.pct ?? 0, c.pct ?? 0);
      prev.recycled = prev.recycled || c.recycled;
    }
  }
  return [...byFiber.values()].slice(0, 12);
}

/** Recursively collect every object whose @type is (or includes) "Product" from a parsed JSON-LD value. */
function collectProducts(node: unknown, acc: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || node == null) return; // bound recursion against deeply-nested/hostile JSON
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, acc, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const type = o["@type"];
  const isProduct =
    type === "Product" ||
    (Array.isArray(type) && type.some((t) => t === "Product")) ||
    (typeof type === "string" && type.toLowerCase() === "product");
  if (isProduct) acc.push(o);
  // Descend into @graph and any nested objects/arrays (mainEntity, hasVariant, etc.).
  if (Array.isArray(o["@graph"])) collectProducts(o["@graph"], acc, depth + 1);
  for (const key of Object.keys(o)) {
    if (key === "@graph") continue;
    const v = o[key];
    if (v && typeof v === "object") collectProducts(v, acc, depth + 1);
  }
}

/** Pull the first offer object from a Product's `offers` (which may be an object or array). */
function firstOffer(product: Record<string, unknown>): Record<string, unknown> | null {
  const offers = product.offers;
  if (!offers) return null;
  if (Array.isArray(offers)) {
    for (const o of offers) if (o && typeof o === "object") return o as Record<string, unknown>;
    return null;
  }
  if (typeof offers === "object") return offers as Record<string, unknown>;
  return null;
}

function brandOf(product: Record<string, unknown>): string | null {
  const b = product.brand;
  if (b == null) return null;
  if (typeof b === "string") return firstNonEmptyString(b);
  if (Array.isArray(b)) {
    for (const item of b) {
      const s = brandOf({ brand: item });
      if (s) return s;
    }
    return null;
  }
  if (typeof b === "object") return scalarOf((b as Record<string, unknown>).name) ?? scalarOf(b);
  return null;
}

function readAdditionalProps(product: Record<string, unknown>): ExtractedSpec[] {
  const ap = product.additionalProperty;
  if (!Array.isArray(ap)) return [];
  const out: ExtractedSpec[] = [];
  for (const item of ap) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = scalarOf(o.name) ?? scalarOf(o.propertyID);
    const value = scalarOf(o.value) ?? scalarOf(o["@value"]);
    if (name && value) out.push({ name, value });
    if (out.length >= 60) break;
  }
  return out;
}

/** Find the spec whose name matches any of the given (lowercased) keywords. */
function specMatching(specs: ExtractedSpec[], keywords: string[]): string | null {
  for (const sp of specs) {
    const n = sp.name.toLowerCase();
    if (keywords.some((k) => n.includes(k))) return sp.value;
  }
  return null;
}

function extractFromJsonLd(html: string): ExtractedProduct | null {
  const products: Record<string, unknown>[] = [];
  const scriptRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = scriptRe.exec(html)) !== null && scanned < 50) {
    scanned++;
    const body = m[1];
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue; // broken JSON in one block never sinks the whole extraction
    }
    collectProducts(parsed, products);
  }
  if (products.length === 0) return null;

  // Prefer the most-populated product (most keys) when several are present (variant arrays, @graph).
  const product = products.reduce((best, p) => (Object.keys(p).length > Object.keys(best).length ? p : best));
  const offer = firstOffer(product);
  const specs = readAdditionalProps(product);

  const name = scalarOf(product.name);
  const brand = brandOf(product);
  const sku = scalarOf(product.sku) ?? scalarOf(product.gtin13) ?? scalarOf(product.gtin);
  const mpn = scalarOf(product.mpn);

  const priceRaw = offer ? (offer.price ?? offer.lowPrice ?? (offer.priceSpecification as any)?.price) : null;
  const price_cents = toCents(priceRaw);
  const price_currency =
    (offer
      ? scalarOf(offer.priceCurrency) ?? scalarOf((offer.priceSpecification as any)?.priceCurrency)
      : null) ?? null;

  const weight_grams =
    toGrams(product.weight) ??
    toGrams(specMatching(specs, ["weight"]));

  const material_raw =
    scalarOf(product.material) ??
    specMatching(specs, ["material", "composition", "fabric", "fiber", "fibre"]);

  const fiber_components = material_raw ? parseComposition(material_raw) : [];

  return {
    name,
    brand,
    sku,
    mpn,
    price_cents,
    price_currency: price_currency ? price_currency.toUpperCase() : null,
    weight_grams,
    material_raw,
    fiber_components,
    specs,
    source: "json-ld",
  };
}

/** Read the value of one attribute from a SINGLE <meta ...> tag's inner text, quote-aware. */
function attrValue(tagInner: string, attr: string): string | null {
  const esc = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The `\1` back-reference forces the closing quote to match the opening one, so a single-quote inside
  // a double-quoted value (and vice versa) is preserved — e.g. content="Arc'teryx" reads in full.
  const re = new RegExp(`\\b${esc}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const m = tagInner.match(re);
  return m && typeof m[2] === "string" ? m[2] : null;
}

/**
 * Read the `content` of the first <meta> tag whose `property` or `name` equals `key`. We tokenise the
 * HTML into individual <meta ...> tags FIRST and match attributes within a single tag — never across tag
 * boundaries — so a lazy quantifier can't bleed one tag's `content` into another tag's `property`.
 */
function metaContent(html: string, key: string): string | null {
  const tagRe = /<meta\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = tagRe.exec(html)) !== null && scanned < 300) {
    scanned++;
    const inner = m[1] ?? "";
    const propOrName = attrValue(inner, "property") ?? attrValue(inner, "name");
    if (propOrName == null) continue;
    if (decodeEntities(propOrName).trim().toLowerCase() !== key.toLowerCase()) continue;
    const content = attrValue(inner, "content");
    if (content == null) continue;
    const t = decodeEntities(content).trim();
    if (t !== "") return t;
  }
  return null;
}

function extractFromOpenGraph(html: string): ExtractedProduct | null {
  // A bare <title> is NOT a product signal (every page has one). We only treat the page as a product
  // source when an OG/product meta tag is actually present; the <title> is used solely as a name
  // fallback once such a signal exists.
  const ogTitle = metaContent(html, "og:title") ?? metaContent(html, "twitter:title");
  const brand =
    metaContent(html, "og:brand") ??
    metaContent(html, "product:brand");
  const priceAmount =
    metaContent(html, "product:price:amount") ??
    metaContent(html, "og:price:amount");
  const price_currency =
    metaContent(html, "product:price:currency") ??
    metaContent(html, "og:price:currency");
  const mpn = metaContent(html, "product:mfr_part_no") ?? metaContent(html, "product:retailer_part_no");
  const ogType = metaContent(html, "og:type");

  const price_cents = toCents(priceAmount);

  // Require a genuine product signal before claiming this as a manufacturer product page.
  const hasProductSignal =
    ogTitle != null || brand != null || price_cents != null || (ogType?.toLowerCase() === "product");
  if (!hasProductSignal) return null;

  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  const name = ogTitle ?? (titleTag ? decodeEntities(titleTag).trim() || null : null);
  const cleanName = name ? name.trim() || null : null;

  // og:site_name is only a brand hint when an explicit brand tag is absent AND there's another signal.
  const resolvedBrand = brand ?? (price_cents != null || ogTitle != null ? metaContent(html, "og:site_name") : null);

  if (!cleanName && !resolvedBrand && price_cents == null) return null;

  return {
    name: cleanName,
    brand: resolvedBrand ?? null,
    sku: null,
    mpn: mpn ?? null,
    price_cents,
    price_currency: price_currency ? price_currency.toUpperCase() : null,
    weight_grams: null,
    material_raw: null,
    fiber_components: [],
    specs: [],
    source: "opengraph",
  };
}

/** Merge OG-derived fields into a JSON-LD result, filling only the gaps (JSON-LD wins). */
function fillGaps(primary: ExtractedProduct, fallback: ExtractedProduct): ExtractedProduct {
  return {
    name: primary.name ?? fallback.name,
    brand: primary.brand ?? fallback.brand,
    sku: primary.sku ?? fallback.sku,
    mpn: primary.mpn ?? fallback.mpn,
    price_cents: primary.price_cents ?? fallback.price_cents,
    price_currency: primary.price_currency ?? fallback.price_currency,
    weight_grams: primary.weight_grams ?? fallback.weight_grams,
    material_raw: primary.material_raw ?? fallback.material_raw,
    fiber_components: primary.fiber_components.length ? primary.fiber_components : fallback.fiber_components,
    specs: primary.specs.length ? primary.specs : fallback.specs,
    source: primary.source,
  };
}

/**
 * Extract authoritative product specs from an already-fetched HTML string. PURE and DEFENSIVE: it never
 * throws on arbitrary, malformed, huge, or hostile input — it returns the EMPTY result (all nulls) when
 * nothing usable is present.
 */
export function parseProductHtml(html: string): ExtractedProduct {
  if (typeof html !== "string" || html === "") return { ...EMPTY };
  const input = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;

  let jsonLd: ExtractedProduct | null = null;
  let og: ExtractedProduct | null = null;
  try {
    jsonLd = extractFromJsonLd(input);
  } catch {
    jsonLd = null; // a pathological regex/parse path must never escape
  }
  try {
    og = extractFromOpenGraph(input);
  } catch {
    og = null;
  }

  if (jsonLd && og) return fillGaps(jsonLd, og);
  if (jsonLd) return jsonLd;
  if (og) return og;
  return { ...EMPTY };
}
