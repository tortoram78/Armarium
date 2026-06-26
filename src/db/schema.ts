// RLS + ownership policies are out-of-band in drizzle/0003_enable_rls_auth.sql (Phase 3 step 1).
// Drizzle schema — the capability-first hybrid (DESIGN.md §6, ADR-0003).
// - Load-bearing facets are typed columns on `items`; soft facets carry a value + confidence + source.
// - Multi-label facets are text[] (GIN-indexed). The long tail is a JSONB `facets` bag (GIN-indexed).
// - Domain clusters are OPTIONAL, COMPOSABLE 1:1 group tables (an item may have several at once), so a
//   multi-domain item (e.g. an insulated waterproof boot) is just insulation + shell + footwear.
// - Enum *ordering* lives in src/core/facets/levels.ts, not in Postgres enums; columns are plain text
//   validated at the Zod boundary. `user_id` is on every user-owned table (rule #4); the materials and
//   treatments libraries are intentionally shared/global (no user_id).

import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp, date, index, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ItemClassification } from "@/core/classification";

// ---- shared libraries (global, no user_id) ----
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fiberComponents: jsonb("fiber_components").$type<{ fiber: string; pct: number | null; recycled?: boolean }[]>(),
  constructionType: text("construction_type"),
  behavior: jsonb("behavior").$type<Record<string, unknown>>(), // derived material behavioral facets
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const treatments = pgTable("treatments", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // 'dwr' | 'hydrophobic_down'
  description: text("description"),
});

// ---- core item (user-owned) ----
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),

    // identity hard facts (+ source markers)
    brand: text("brand"),
    model: text("model"),
    priceCents: integer("price_cents"),
    priceSrc: text("price_src"),
    weightGrams: integer("weight_grams"),
    weightSrc: text("weight_src"),
    upf: integer("upf"),
    upfSrc: text("upf_src"),

    // universal soft facets: value + confidence + source
    waterproofness: text("waterproofness"), waterproofnessConf: text("waterproofness_conf"), waterproofnessSrc: text("waterproofness_src"),
    windResistance: text("wind_resistance"), windResistanceConf: text("wind_resistance_conf"), windResistanceSrc: text("wind_resistance_src"),
    breathability: text("breathability"), breathabilityConf: text("breathability_conf"), breathabilitySrc: text("breathability_src"),
    moistureManagement: text("moisture_management"), moistureManagementConf: text("moisture_management_conf"), moistureManagementSrc: text("moisture_management_src"),
    drySpeed: text("dry_speed"), drySpeedConf: text("dry_speed_conf"), drySpeedSrc: text("dry_speed_src"),
    warmthWhenWet: text("warmth_when_wet"), warmthWhenWetConf: text("warmth_when_wet_conf"), warmthWhenWetSrc: text("warmth_when_wet_src"),
    warmth: text("warmth"), warmthConf: text("warmth_conf"), warmthSrc: text("warmth_src"),
    packability: text("packability"), packabilityConf: text("packability_conf"), packabilitySrc: text("packability_src"),
    technicalVsLifestyle: text("technical_vs_lifestyle"), technicalVsLifestyleConf: text("technical_vs_lifestyle_conf"), technicalVsLifestyleSrc: text("technical_vs_lifestyle_src"),

    // multi-label facets (text arrays, GIN-indexed)
    layeringRole: text("layering_role").array(),
    functionPurpose: text("function_purpose").array(),
    bodyZoneCovered: text("body_zone_covered").array(),
    activityFit: text("activity_fit").array(),
    conditionsFit: text("conditions_fit").array(),

    // long-tail facets (never capability gates) — Zod-validated, GIN-indexed
    facets: jsonb("facets").$type<Record<string, unknown>>().default({}),

    // material construction roles (named, nullable)
    shellMaterialId: uuid("shell_material_id").references(() => materials.id),
    membraneMaterialId: uuid("membrane_material_id").references(() => materials.id),
    insulationMaterialId: uuid("insulation_material_id").references(() => materials.id),
    liningMaterialId: uuid("lining_material_id").references(() => materials.id),

    // lossless classification source-of-truth (reads reconstruct StoredItem from this, not typed columns)
    classification: jsonb("classification").$type<ItemClassification>().notNull(),

    // display-only item photo (ADR-0018). The object path in the PRIVATE `item-images` bucket
    // (`<user_id>/<item_id>/<uuid>.<ext>`), or null when no photo. NOT a facet / never a capability
    // gate — it is decoration. Reads return it; the UI signs it via getSignedItemImageUrl (the bucket
    // is private, so the bare path is not a public URL). Storage RLS keys the first path segment to the
    // owner's uid (see drizzle/0007) — buildItemImageObjectPath in src/server/item-images.ts is the one
    // place that constructs this scheme, so the upload action and this column never drift.
    imagePath: text("image_path"),

    // ---- inventory / possession layer (ADR-0021, ADR-0022, ADR-0023) ----
    // Physical and ownership metadata stored ALONGSIDE (never inside) the behavioral classification.
    // All columns default to 'owned' / 1 / null so existing rows get sensible values without a
    // partial backfill (the migration backfills `ownership_status = 'wishlist'` for catalog-only rows
    // where in_inventory = false, which is the only case where the default would be wrong).
    ownershipStatus: text("ownership_status").notNull().default("owned"),
    quantity: integer("quantity").notNull().default(1),
    condition: text("condition"),
    // ISO 8601 date ('YYYY-MM-DD'), stored as plain text via Drizzle's date column in string mode.
    // Distinct from any classification date: this is when the user acquired the physical item.
    acquiredAt: date("acquired_at", { mode: "string" }),
    // Purchase price in cents (e.g. 9900 = $99.00). DISTINCT from priceCents (MSRP from classification).
    pricePaidCents: integer("price_paid_cents"),
    acquiredFrom: text("acquired_from"),
    storageLocation: text("storage_location"),
    size: text("size"),
    color: text("color"),
    userNotes: text("user_notes"),
    // Domain membership marker — NOT a routing discriminator. GIN-indexed for array membership queries.
    domains: text("domains").array().notNull().default(sql`'{}'`),
    // Free-form user-curated tags (e.g. "ultralight", "borrowed"). Orthogonal to facets — NOT a
    // capability input, NOT a hardcoded category. Purely a user cross-cutting label for browsing/filtering.
    // GIN-indexed to mirror the domains pattern for efficient array-membership queries.
    userTags: text("user_tags").array().notNull().default(sql`'{}'`),

    // provenance + ownership (DEPRECATED mirrors — keep; do not drop until migration strategy is set)
    rawText: text("raw_text"),
    inInventory: boolean("in_inventory").notNull().default(false),
    draft: boolean("draft").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("items_user_idx").on(t.userId),
    // Keyset pagination index: newest-first within a user, with id as a stable tiebreaker so the
    // (created_at, id) cursor stays index-only. Matches listItemsPage's ORDER BY exactly.
    userKeysetIdx: index("items_user_keyset_idx").on(t.userId, t.createdAt.desc(), t.id.desc()),
    layeringRoleIdx: index("items_layering_role_idx").using("gin", t.layeringRole),
    functionPurposeIdx: index("items_function_purpose_idx").using("gin", t.functionPurpose),
    facetsIdx: index("items_facets_idx").using("gin", t.facets),
    // GIN index on domains mirrors the array-facet pattern; enables efficient membership queries
    // (e.g. "items where 'gear' = ANY(domains)") used by listItemsPage's domain filter.
    domainsIdx: index("items_domains_idx").using("gin", t.domains),
    // GIN index on user_tags mirrors the domains pattern; enables efficient membership queries
    // (e.g. "items where 'ultralight' = ANY(user_tags)") used by listItemsPage's tag filter.
    userTagsIdx: index("items_user_tags_idx").using("gin", t.userTags),
  }),
);

// ---- composable optional domain groups (1:1 with items; an item may have several) ----
export const itemInsulation = pgTable("item_insulation", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  fillType: text("fill_type"), fillTypeSrc: text("fill_type_src"),
  fillPower: integer("fill_power"), fillPowerSrc: text("fill_power_src"),
  fillSpecies: text("fill_species"), fillSpeciesSrc: text("fill_species_src"),
  fillWeightG: integer("fill_weight_g"), fillWeightSrc: text("fill_weight_src"),
  hydrophobicTreatment: boolean("hydrophobic_treatment"), hydrophobicTreatmentSrc: text("hydrophobic_treatment_src"),
  wetPerformance: text("wet_performance"), wetPerformanceConf: text("wet_performance_conf"), wetPerformanceSrc: text("wet_performance_src"),
  warmthForWeight: text("warmth_for_weight"), warmthForWeightConf: text("warmth_for_weight_conf"), warmthForWeightSrc: text("warmth_for_weight_src"),
});

export const itemSleep = pgTable("item_sleep", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  tempRatingValue: integer("temp_rating_value"), tempRatingValueSrc: text("temp_rating_value_src"),
  tempRatingUnit: text("temp_rating_unit"), tempRatingUnitSrc: text("temp_rating_unit_src"),
  tempRatingStandard: text("temp_rating_standard"), tempRatingStandardConf: text("temp_rating_standard_conf"), tempRatingStandardSrc: text("temp_rating_standard_src"),
  shape: text("shape"), shapeConf: text("shape_conf"), shapeSrc: text("shape_src"),
  padRValueRecommended: real("pad_r_value_recommended"), padRValueConf: text("pad_r_value_conf"), padRValueSrc: text("pad_r_value_src"),
});

export const itemShell = pgTable("item_shell", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  protectionCeiling: text("protection_ceiling"), protectionCeilingConf: text("protection_ceiling_conf"), protectionCeilingSrc: text("protection_ceiling_src"),
  seamSealing: text("seam_sealing"), seamSealingSrc: text("seam_sealing_src"),
  hood: boolean("hood"), hoodSrc: text("hood_src"),
  pitZips: boolean("pit_zips"), pitZipsSrc: text("pit_zips_src"),
});

export const itemCarry = pgTable("item_carry", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  capacityLiters: real("capacity_liters"), capacityLitersSrc: text("capacity_liters_src"),
  suspension: text("suspension"), suspensionConf: text("suspension_conf"), suspensionSrc: text("suspension_src"),
  maxComfortableLoadKg: real("max_comfortable_load_kg"), maxComfortableLoadConf: text("max_comfortable_load_conf"), maxComfortableLoadSrc: text("max_comfortable_load_src"),
});

export const itemFootwear = pgTable("item_footwear", {
  itemId: uuid("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  supportStiffness: integer("support_stiffness"), supportStiffnessConf: text("support_stiffness_conf"), supportStiffnessSrc: text("support_stiffness_src"),
  ankleHeight: text("ankle_height"), ankleHeightConf: text("ankle_height_conf"), ankleHeightSrc: text("ankle_height_src"),
  cramponCompat: text("crampon_compat"), cramponCompatSrc: text("crampon_compat_src"),
  waterManagement: text("water_management"), waterManagementConf: text("water_management_conf"), waterManagementSrc: text("water_management_src"),
});

export const itemTreatments = pgTable(
  "item_treatments",
  {
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    treatmentId: uuid("treatment_id").notNull().references(() => treatments.id),
    condition: text("condition"), // factory_fresh | degraded | refreshed
  },
  (t) => ({ pk: primaryKey({ columns: [t.itemId, t.treatmentId] }) }),
);

// ---- novel LLM extractions parked for review (never silently discarded) ----
export const pendingFacets = pgTable("pending_facets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
  rawKey: text("raw_key").notNull(),
  rawValue: jsonb("raw_value"),
  evidence: text("evidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- item evidence store: the per-claim audit log (ADR-0012 Element 2) ----
// One row per CLAIM (one source's assertion about one facet) — the durable, queryable backing for the
// resolver's Claim<V> set. A facet may have several rows (one per source); the resolver groups by
// facet_key and decides the winner via SOURCE_PRECEDENCE (src/core/resolve/resolve-facet.ts). `value`
// is jsonb (scalar OR array). No user_id column: access is gated through the parent items row (the
// subtype-table pattern), so RLS mirrors drizzle/0003's EXISTS-on-parent policy. Persisted on save with
// REPLACE semantics — a re-resolution writes the current full claim set for the item.
export const itemEvidence = pgTable(
  "item_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    facetKey: text("facet_key").notNull(),
    value: jsonb("value").notNull(), // scalar or array; the resolved claim value
    confidence: text("confidence").notNull(), // "low" | "medium" | "high"
    source: text("source").notNull(), // SOURCE vocab (manufacturer | user | inferred | derived_from_material | ...)
    sourceUrl: text("source_url"),
    extractorVersion: text("extractor_version"),
    evidence: text("evidence").notNull(), // the audit-trail string for this claim
    observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    itemFacetIdx: index("item_evidence_item_facet_idx").on(t.itemId, t.facetKey),
  }),
);

// ---- trips (user-owned, revisitable) ----
// `updatedAt` tracks rename / conditions edits / re-plans. The (user_id, created_at, id) index backs
// keyset pagination of items AND keeps trip lookups user-scoped & cheap; the items keyset index is the
// one that matters for paging (see items table below) — this one mirrors it for trips listing order.
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    rawDescription: text("raw_description"),
    conditions: jsonb("conditions").$type<Record<string, unknown>>(),
    resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("trips_user_idx").on(t.userId),
  }),
);

// ---- classification cache: the split store (ADR-0012 Element 5) ----
// The single shared cache was replaced by two stores so one user's correction can never poison
// another user's next classification (cross-tenant poisoning). See src/core/cache.ts for the contract.

// 1. llm_draft_cache — GLOBAL, low-authority DRAFTS (LLM-extracted + seed classifications). A hit is a
//    starting draft for review, NOT authoritative. No user_id; service-role only (RLS-on, no policies),
//    exactly like the old classification_cache. `source` records draft provenance ("llm" | "seed").
export const llmDraftCache = pgTable("llm_draft_cache", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  classification: jsonb("classification").$type<ItemClassification>().notNull(),
  source: text("source").notNull(), // "llm" | "seed"
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 2. user_overrides — PER-USER corrections/confirmations, RLS-scoped to the owner. PK (user_id, key):
//    each user has at most one override per normalized name, and a correction by user A is invisible to
//    user B. user_id is NOT NULL (rule #4); owner policies mirror drizzle/0003 ((select auth.uid())=user_id).
export const userOverrides = pgTable(
  "user_overrides",
  {
    userId: uuid("user_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    classification: jsonb("classification").$type<ItemClassification>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.key] }) }),
);

// ---- user collections (user-owned named sets of items) ----
// A collection is a free-form label a user can apply to N items. Collections have no behavioral
// semantics — they are a curation/browsing tool only, entirely orthogonal to facets/capabilities.
// user_id is present per rule #4. RLS mirrors 0003: owner policy for collections; EXISTS-on-parent
// for collection_items (the junction table carries no user_id column).

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("collections_user_idx").on(t.userId),
  }),
);

// Junction table: which items belong to which collection. Cascade on both sides so deleting
// either a collection or an item cleans up the membership row. No user_id column — access is
// gated through the parent collections row (the EXISTS-on-parent RLS pattern, same as item subtypes).
export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.itemId] }),
    // Secondary index on itemId: enables "which collections contain this item" queries
    // (collectionsForItem, removeItemFromCollection) without a full sequential scan.
    itemIdx: index("collection_items_item_idx").on(t.itemId),
  }),
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
