// RLS + ownership policies are out-of-band in drizzle/0003_enable_rls_auth.sql (Phase 3 step 1).
// Drizzle schema — the capability-first hybrid (DESIGN.md §6, ADR-0003).
// - Load-bearing facets are typed columns on `items`; soft facets carry a value + confidence + source.
// - Multi-label facets are text[] (GIN-indexed). The long tail is a JSONB `facets` bag (GIN-indexed).
// - Domain clusters are OPTIONAL, COMPOSABLE 1:1 group tables (an item may have several at once), so a
//   multi-domain item (e.g. an insulated waterproof boot) is just insulation + shell + footwear.
// - Enum *ordering* lives in src/core/facets/levels.ts, not in Postgres enums; columns are plain text
//   validated at the Zod boundary. `user_id` is on every user-owned table (rule #4); the materials and
//   treatments libraries are intentionally shared/global (no user_id).

import { pgTable, uuid, text, integer, real, boolean, jsonb, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
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

    // provenance + ownership
    rawText: text("raw_text"),
    inInventory: boolean("in_inventory").notNull().default(false),
    draft: boolean("draft").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("items_user_idx").on(t.userId),
    layeringRoleIdx: index("items_layering_role_idx").using("gin", t.layeringRole),
    functionPurposeIdx: index("items_function_purpose_idx").using("gin", t.functionPurpose),
    facetsIdx: index("items_facets_idx").using("gin", t.facets),
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

// ---- trips (user-owned, revisitable) ----
export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  rawDescription: text("raw_description"),
  conditions: jsonb("conditions").$type<Record<string, unknown>>(),
  resultSnapshot: jsonb("result_snapshot").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---- classification cache (shared reference data — no user_id) ----
// This is the self-building knowledge base: a normalized item name maps to a validated classification
// so repeat adds skip the LLM. Like `materials` and `treatments`, it is intentionally global (not
// user-owned) — a correction by any user improves the cache for all users (source:"user" entries).
export const classificationCache = pgTable("classification_cache", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  classification: jsonb("classification").$type<ItemClassification>().notNull(),
  source: text("source").notNull(), // "llm" | "user" | "seed"
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
