// Framework-agnostic CORE of manufacturer-URL enrichment (Phase 3 step 2).
//
// PURE: no next/*, no React, no DB, no networking/DNS. The actual fetch + DNS/private-IP SSRF checks
// live in a separate server-layer task; this core receives an already-fetched HTML string + the URL.
//
//   validateEnrichUrl  — the URL-shape SSRF gate (https-only, allowlisted host, no creds/port/IP).
//   parseProductHtml   — dependency-free JSON-LD + OpenGraph spec extraction (never throws).
//   toManufacturerEvidence — map extracted specs onto the validated classification shapes (source:"manufacturer").

export {
  validateEnrichUrl,
  MANUFACTURER_ALLOWLIST,
  type ValidateEnrichUrlResult,
} from "./url-gate";

export {
  parseProductHtml,
  parseComposition,
  type ExtractedProduct,
  type ExtractedFiber,
  type ExtractedSpec,
} from "./parse-html";

export {
  toManufacturerEvidence,
  type ManufacturerEnrichment,
} from "./to-evidence";

export { applyManufacturerOverlay, unknownBehavioralClassification } from "./merge";
