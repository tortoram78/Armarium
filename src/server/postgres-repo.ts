// Postgres GearRepository — Drizzle ORM over Supabase Postgres.
// This module is safe to import with no DATABASE_URL: `getDb()` throws only on first query, never at
// module load. The client is a lazy singleton; importing this file has ZERO connection side effects.
//
// Design decisions:
//   - Writes: project hot/typed columns from classification at insert/update time (best-effort,
//     denormalized for indexing). The `classification` jsonb column is the LOSSLESS source of truth.
//   - Reads: reconstruct StoredItem entirely from the `classification` jsonb + the row's own scalars
//     (id, userId, name, inInventory, draft, rawText, createdAt). No re-assembly from typed columns.
//   - Cascade deletes on group tables are handled by DB FKs (onDelete: "cascade") — no manual cleanup.
//   - Every query is user-scoped (WHERE user_id = $userId) — rule #4.
//
// TENANT ISOLATION (read before adding any method): the app connects as the table OWNER role
// (src/db/client.ts). A Postgres owner BYPASSES RLS unless the table sets FORCE ROW LEVEL SECURITY —
// and none do — so the RLS policies are DORMANT for this connection; they protect only the public
// PostgREST/anon surface (direct API access). The app-layer `WHERE user_id = $userId` (or a
// userId-keyed parent-item check) is therefore the SOLE live tenant isolation and is MANDATORY on
// EVERY query of EVERY method — there is no DB backstop. True DB-level defense-in-depth (FORCE RLS +
// per-request auth.uid() under a non-owner role) is a future hardening, deliberately not in place.
// test/repo.cross-tenant.test.ts is the guard that proves the app-layer scope holds across the whole
// method surface (it runs against the memory repo, which shares this isolation contract).

import { eq, and, or, lt, desc, asc, ilike, sql, count, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { getDb } from "./db";
import {
  items,
  itemInsulation,
  itemSleep,
  itemShell,
  itemCarry,
  itemFootwear,
  itemEvidence,
  collections,
  collectionItems,
  pendingFacets,
  userOverrides,
} from "@/db/schema";
import type {
  GearRepository,
  StoredItem,
  StoredTrip,
  AddItemInput,
  SaveTripInput,
  PageOpts,
  ItemsPage,
  EvidenceClaim,
  Collection,
} from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { TripConditions } from "@/core/conditions";
import type { RecommendationResult } from "@/core/recommend";
import { DEFAULT_INVENTORY } from "@/core/inventory";
import type { InventoryMeta } from "@/core/inventory";
import { trips } from "@/db/schema";

// ---- projection helpers (typed columns ← classification; best-effort, not the read path) ----

function projectUniversal(c: ItemClassification) {
  const u = c.universal;
  return {
    waterproofness: u.waterproofness.value,
    waterproofnessConf: u.waterproofness.value !== null ? (u.waterproofness as { confidence: string }).confidence : null,
    waterproofnessSrc: u.waterproofness.value !== null ? (u.waterproofness as { source: string }).source : null,
    windResistance: u.wind_resistance.value,
    windResistanceConf: u.wind_resistance.value !== null ? (u.wind_resistance as { confidence: string }).confidence : null,
    windResistanceSrc: u.wind_resistance.value !== null ? (u.wind_resistance as { source: string }).source : null,
    breathability: u.breathability.value,
    breathabilityConf: u.breathability.value !== null ? (u.breathability as { confidence: string }).confidence : null,
    breathabilitySrc: u.breathability.value !== null ? (u.breathability as { source: string }).source : null,
    moistureManagement: u.moisture_management.value,
    moistureManagementConf: u.moisture_management.value !== null ? (u.moisture_management as { confidence: string }).confidence : null,
    moistureManagementSrc: u.moisture_management.value !== null ? (u.moisture_management as { source: string }).source : null,
    drySpeed: u.dry_speed.value,
    drySpeedConf: u.dry_speed.value !== null ? (u.dry_speed as { confidence: string }).confidence : null,
    drySpeedSrc: u.dry_speed.value !== null ? (u.dry_speed as { source: string }).source : null,
    warmthWhenWet: u.warmth_when_wet.value,
    warmthWhenWetConf: u.warmth_when_wet.value !== null ? (u.warmth_when_wet as { confidence: string }).confidence : null,
    warmthWhenWetSrc: u.warmth_when_wet.value !== null ? (u.warmth_when_wet as { source: string }).source : null,
    warmth: u.warmth.value,
    warmthConf: u.warmth.value !== null ? (u.warmth as { confidence: string }).confidence : null,
    warmthSrc: u.warmth.value !== null ? (u.warmth as { source: string }).source : null,
    packability: u.packability.value,
    packabilityConf: u.packability.value !== null ? (u.packability as { confidence: string }).confidence : null,
    packabilitySrc: u.packability.value !== null ? (u.packability as { source: string }).source : null,
    technicalVsLifestyle: u.technical_vs_lifestyle.value,
    technicalVsLifestyleConf:
      u.technical_vs_lifestyle.value !== null ? (u.technical_vs_lifestyle as { confidence: string }).confidence : null,
    technicalVsLifestyleSrc:
      u.technical_vs_lifestyle.value !== null ? (u.technical_vs_lifestyle as { source: string }).source : null,
    upf: u.upf.value,
    upfSrc: u.upf.value !== null ? (u.upf as { source: string }).source : null,
  };
}

function projectIdentity(c: ItemClassification) {
  const id = c.identity;
  return {
    brand: id.brand.value,
    model: id.model.value,
    priceCents: id.price_cents.value,
    priceSrc: id.price_cents.value !== null ? (id.price_cents as { source: string }).source : null,
    weightGrams: id.weight_grams.value,
    weightSrc: id.weight_grams.value !== null ? (id.weight_grams as { source: string }).source : null,
  };
}

function projectMultilabel(c: ItemClassification) {
  const m = c.multilabel;
  return {
    layeringRole: m.layering_role.length > 0 ? m.layering_role : null,
    functionPurpose: m.function_purpose.length > 0 ? m.function_purpose : null,
    bodyZoneCovered: m.body_zone_covered.length > 0 ? m.body_zone_covered : null,
    activityFit: m.activity_fit.length > 0 ? m.activity_fit : null,
    conditionsFit: m.conditions_fit.length > 0 ? m.conditions_fit : null,
  };
}

// ---- row → StoredItem (reads from jsonb classification — the lossless path) ----

function rowToStoredItem(row: {
  id: string;
  userId: string;
  name: string;
  inInventory: boolean;
  draft: boolean;
  rawText: string | null;
  imagePath: string | null;
  classification: ItemClassification;
  createdAt: Date;
  // inventory columns (nullable: pre-migration rows get DB defaults after 0008 migration)
  ownershipStatus?: string | null;
  quantity?: number | null;
  condition?: string | null;
  acquiredAt?: string | null;
  pricePaidCents?: number | null;
  acquiredFrom?: string | null;
  storageLocation?: string | null;
  size?: string | null;
  color?: string | null;
  userNotes?: string | null;
  domains?: string[] | null;
  userTags?: string[] | null;
}): StoredItem {
  // Map typed inventory columns → InventoryMeta. Fall through to DEFAULT_INVENTORY for any column that
  // is null/undefined (rows predating the 0008 migration get DB column defaults, so this is belt-and-
  // suspenders; the migration backfill also corrects the wishlist case at the SQL level).
  const inventory: InventoryMeta = {
    ownershipStatus: (row.ownershipStatus as InventoryMeta["ownershipStatus"]) ?? DEFAULT_INVENTORY.ownershipStatus,
    quantity: row.quantity ?? DEFAULT_INVENTORY.quantity,
    condition: (row.condition as InventoryMeta["condition"]) ?? DEFAULT_INVENTORY.condition,
    acquiredAt: row.acquiredAt ?? DEFAULT_INVENTORY.acquiredAt,
    pricePaidCents: row.pricePaidCents ?? DEFAULT_INVENTORY.pricePaidCents,
    acquiredFrom: row.acquiredFrom ?? DEFAULT_INVENTORY.acquiredFrom,
    storageLocation: row.storageLocation ?? DEFAULT_INVENTORY.storageLocation,
    size: row.size ?? DEFAULT_INVENTORY.size,
    color: row.color ?? DEFAULT_INVENTORY.color,
    userNotes: row.userNotes ?? DEFAULT_INVENTORY.userNotes,
    domains: row.domains ?? DEFAULT_INVENTORY.domains,
    userTags: row.userTags ?? DEFAULT_INVENTORY.userTags,
  };

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    inInventory: row.inInventory,
    draft: row.draft,
    rawText: row.rawText ?? undefined,
    // Display-only photo path (ADR-0018). Surfaced on reads so the UI wave can sign it; null when no photo.
    imagePath: row.imagePath ?? null,
    classification: row.classification,
    createdAt: row.createdAt.toISOString(),
    inventory,
  };
}

// ---- keyset pagination cursor (createdAt, id), newest-first ----
// The cursor encodes the createdAt epoch-ms + id of the last row returned. Comparing on the raw
// timestamp (not the truncated ISO string) keeps the keyset boundary exact against the DB column.

const DEFAULT_PAGE_LIMIT = 50;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()} ${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ms, id] = Buffer.from(cursor, "base64url").toString("utf8").split(" ");
    const t = Number(ms);
    if (!Number.isFinite(t) || id === undefined) return null;
    return { createdAt: new Date(t), id };
  } catch {
    return null;
  }
}

// ---- group table upserts (called after item insert/update) ----

async function upsertGroups(db: Db, itemId: string, c: ItemClassification): Promise<void> {
  const g = c.groups;

  if (g.insulation) {
    const ins = g.insulation;
    await db
      .insert(itemInsulation)
      .values({
        itemId,
        fillType: ins.fill_type.value,
        fillTypeSrc: ins.fill_type.value !== null ? (ins.fill_type as { source: string }).source : null,
        fillPower: ins.fill_power.value,
        fillPowerSrc: ins.fill_power.value !== null ? (ins.fill_power as { source: string }).source : null,
        fillSpecies: ins.fill_species.value,
        fillSpeciesSrc: ins.fill_species.value !== null ? (ins.fill_species as { source: string }).source : null,
        fillWeightG: ins.fill_weight_g.value,
        fillWeightSrc: ins.fill_weight_g.value !== null ? (ins.fill_weight_g as { source: string }).source : null,
        hydrophobicTreatment: ins.hydrophobic_treatment.value,
        hydrophobicTreatmentSrc:
          ins.hydrophobic_treatment.value !== null ? (ins.hydrophobic_treatment as { source: string }).source : null,
        wetPerformance: ins.wet_performance.value,
        wetPerformanceConf:
          ins.wet_performance.value !== null ? (ins.wet_performance as { confidence: string }).confidence : null,
        wetPerformanceSrc:
          ins.wet_performance.value !== null ? (ins.wet_performance as { source: string }).source : null,
        warmthForWeight: ins.warmth_for_weight.value,
        warmthForWeightConf:
          ins.warmth_for_weight.value !== null ? (ins.warmth_for_weight as { confidence: string }).confidence : null,
        warmthForWeightSrc:
          ins.warmth_for_weight.value !== null ? (ins.warmth_for_weight as { source: string }).source : null,
      })
      .onConflictDoUpdate({
        target: itemInsulation.itemId,
        set: {
          fillType: ins.fill_type.value,
          fillTypeSrc: ins.fill_type.value !== null ? (ins.fill_type as { source: string }).source : null,
          fillPower: ins.fill_power.value,
          fillPowerSrc: ins.fill_power.value !== null ? (ins.fill_power as { source: string }).source : null,
          fillSpecies: ins.fill_species.value,
          fillSpeciesSrc: ins.fill_species.value !== null ? (ins.fill_species as { source: string }).source : null,
          fillWeightG: ins.fill_weight_g.value,
          fillWeightSrc: ins.fill_weight_g.value !== null ? (ins.fill_weight_g as { source: string }).source : null,
          hydrophobicTreatment: ins.hydrophobic_treatment.value,
          hydrophobicTreatmentSrc:
            ins.hydrophobic_treatment.value !== null ? (ins.hydrophobic_treatment as { source: string }).source : null,
          wetPerformance: ins.wet_performance.value,
          wetPerformanceConf:
            ins.wet_performance.value !== null ? (ins.wet_performance as { confidence: string }).confidence : null,
          wetPerformanceSrc:
            ins.wet_performance.value !== null ? (ins.wet_performance as { source: string }).source : null,
          warmthForWeight: ins.warmth_for_weight.value,
          warmthForWeightConf:
            ins.warmth_for_weight.value !== null ? (ins.warmth_for_weight as { confidence: string }).confidence : null,
          warmthForWeightSrc:
            ins.warmth_for_weight.value !== null ? (ins.warmth_for_weight as { source: string }).source : null,
        },
      });
  }

  if (g.sleep) {
    const sl = g.sleep;
    await db
      .insert(itemSleep)
      .values({
        itemId,
        tempRatingValue: sl.temp_rating_value.value,
        tempRatingValueSrc:
          sl.temp_rating_value.value !== null ? (sl.temp_rating_value as { source: string }).source : null,
        tempRatingUnit: sl.temp_rating_unit.value,
        tempRatingUnitSrc:
          sl.temp_rating_unit.value !== null ? (sl.temp_rating_unit as { source: string }).source : null,
        tempRatingStandard: sl.temp_rating_standard.value,
        tempRatingStandardConf:
          sl.temp_rating_standard.value !== null
            ? (sl.temp_rating_standard as { confidence: string }).confidence
            : null,
        tempRatingStandardSrc:
          sl.temp_rating_standard.value !== null ? (sl.temp_rating_standard as { source: string }).source : null,
        shape: sl.sleep_shape.value,
        shapeConf: sl.sleep_shape.value !== null ? (sl.sleep_shape as { confidence: string }).confidence : null,
        shapeSrc: sl.sleep_shape.value !== null ? (sl.sleep_shape as { source: string }).source : null,
        padRValueRecommended: sl.pad_r_value_recommended.value,
        padRValueConf:
          sl.pad_r_value_recommended.value !== null
            ? (sl.pad_r_value_recommended as { confidence: string }).confidence
            : null,
        padRValueSrc:
          sl.pad_r_value_recommended.value !== null
            ? (sl.pad_r_value_recommended as { source: string }).source
            : null,
      })
      .onConflictDoUpdate({
        target: itemSleep.itemId,
        set: {
          tempRatingValue: sl.temp_rating_value.value,
          tempRatingValueSrc:
            sl.temp_rating_value.value !== null ? (sl.temp_rating_value as { source: string }).source : null,
          tempRatingUnit: sl.temp_rating_unit.value,
          tempRatingUnitSrc:
            sl.temp_rating_unit.value !== null ? (sl.temp_rating_unit as { source: string }).source : null,
          tempRatingStandard: sl.temp_rating_standard.value,
          tempRatingStandardConf:
            sl.temp_rating_standard.value !== null
              ? (sl.temp_rating_standard as { confidence: string }).confidence
              : null,
          tempRatingStandardSrc:
            sl.temp_rating_standard.value !== null ? (sl.temp_rating_standard as { source: string }).source : null,
          shape: sl.sleep_shape.value,
          shapeConf: sl.sleep_shape.value !== null ? (sl.sleep_shape as { confidence: string }).confidence : null,
          shapeSrc: sl.sleep_shape.value !== null ? (sl.sleep_shape as { source: string }).source : null,
          padRValueRecommended: sl.pad_r_value_recommended.value,
          padRValueConf:
            sl.pad_r_value_recommended.value !== null
              ? (sl.pad_r_value_recommended as { confidence: string }).confidence
              : null,
          padRValueSrc:
            sl.pad_r_value_recommended.value !== null
              ? (sl.pad_r_value_recommended as { source: string }).source
              : null,
        },
      });
  }

  if (g.shell) {
    const sh = g.shell;
    await db
      .insert(itemShell)
      .values({
        itemId,
        protectionCeiling: sh.protection_ceiling.value,
        protectionCeilingConf:
          sh.protection_ceiling.value !== null ? (sh.protection_ceiling as { confidence: string }).confidence : null,
        protectionCeilingSrc:
          sh.protection_ceiling.value !== null ? (sh.protection_ceiling as { source: string }).source : null,
        seamSealing: sh.seam_sealing.value,
        seamSealingSrc: sh.seam_sealing.value !== null ? (sh.seam_sealing as { source: string }).source : null,
        hood: sh.hood.value,
        hoodSrc: sh.hood.value !== null ? (sh.hood as { source: string }).source : null,
        pitZips: sh.pit_zips.value,
        pitZipsSrc: sh.pit_zips.value !== null ? (sh.pit_zips as { source: string }).source : null,
      })
      .onConflictDoUpdate({
        target: itemShell.itemId,
        set: {
          protectionCeiling: sh.protection_ceiling.value,
          protectionCeilingConf:
            sh.protection_ceiling.value !== null ? (sh.protection_ceiling as { confidence: string }).confidence : null,
          protectionCeilingSrc:
            sh.protection_ceiling.value !== null ? (sh.protection_ceiling as { source: string }).source : null,
          seamSealing: sh.seam_sealing.value,
          seamSealingSrc: sh.seam_sealing.value !== null ? (sh.seam_sealing as { source: string }).source : null,
          hood: sh.hood.value,
          hoodSrc: sh.hood.value !== null ? (sh.hood as { source: string }).source : null,
          pitZips: sh.pit_zips.value,
          pitZipsSrc: sh.pit_zips.value !== null ? (sh.pit_zips as { source: string }).source : null,
        },
      });
  }

  if (g.carry) {
    const ca = g.carry;
    await db
      .insert(itemCarry)
      .values({
        itemId,
        capacityLiters: ca.capacity_liters.value,
        capacityLitersSrc:
          ca.capacity_liters.value !== null ? (ca.capacity_liters as { source: string }).source : null,
        suspension: ca.suspension.value,
        suspensionConf:
          ca.suspension.value !== null ? (ca.suspension as { confidence: string }).confidence : null,
        suspensionSrc: ca.suspension.value !== null ? (ca.suspension as { source: string }).source : null,
        maxComfortableLoadKg: ca.max_comfortable_load_kg.value,
        maxComfortableLoadConf:
          ca.max_comfortable_load_kg.value !== null
            ? (ca.max_comfortable_load_kg as { confidence: string }).confidence
            : null,
        maxComfortableLoadSrc:
          ca.max_comfortable_load_kg.value !== null
            ? (ca.max_comfortable_load_kg as { source: string }).source
            : null,
      })
      .onConflictDoUpdate({
        target: itemCarry.itemId,
        set: {
          capacityLiters: ca.capacity_liters.value,
          capacityLitersSrc:
            ca.capacity_liters.value !== null ? (ca.capacity_liters as { source: string }).source : null,
          suspension: ca.suspension.value,
          suspensionConf:
            ca.suspension.value !== null ? (ca.suspension as { confidence: string }).confidence : null,
          suspensionSrc: ca.suspension.value !== null ? (ca.suspension as { source: string }).source : null,
          maxComfortableLoadKg: ca.max_comfortable_load_kg.value,
          maxComfortableLoadConf:
            ca.max_comfortable_load_kg.value !== null
              ? (ca.max_comfortable_load_kg as { confidence: string }).confidence
              : null,
          maxComfortableLoadSrc:
            ca.max_comfortable_load_kg.value !== null
              ? (ca.max_comfortable_load_kg as { source: string }).source
              : null,
        },
      });
  }

  if (g.footwear) {
    const fw = g.footwear;
    await db
      .insert(itemFootwear)
      .values({
        itemId,
        supportStiffness: fw.support_stiffness.value,
        supportStiffnessConf:
          fw.support_stiffness.value !== null ? (fw.support_stiffness as { confidence: string }).confidence : null,
        supportStiffnessSrc:
          fw.support_stiffness.value !== null ? (fw.support_stiffness as { source: string }).source : null,
        ankleHeight: fw.ankle_height.value,
        ankleHeightConf:
          fw.ankle_height.value !== null ? (fw.ankle_height as { confidence: string }).confidence : null,
        ankleHeightSrc: fw.ankle_height.value !== null ? (fw.ankle_height as { source: string }).source : null,
        cramponCompat: fw.crampon_compat.value,
        cramponCompatSrc:
          fw.crampon_compat.value !== null ? (fw.crampon_compat as { source: string }).source : null,
        waterManagement: fw.water_management.value,
        waterManagementConf:
          fw.water_management.value !== null ? (fw.water_management as { confidence: string }).confidence : null,
        waterManagementSrc:
          fw.water_management.value !== null ? (fw.water_management as { source: string }).source : null,
      })
      .onConflictDoUpdate({
        target: itemFootwear.itemId,
        set: {
          supportStiffness: fw.support_stiffness.value,
          supportStiffnessConf:
            fw.support_stiffness.value !== null ? (fw.support_stiffness as { confidence: string }).confidence : null,
          supportStiffnessSrc:
            fw.support_stiffness.value !== null ? (fw.support_stiffness as { source: string }).source : null,
          ankleHeight: fw.ankle_height.value,
          ankleHeightConf:
            fw.ankle_height.value !== null ? (fw.ankle_height as { confidence: string }).confidence : null,
          ankleHeightSrc: fw.ankle_height.value !== null ? (fw.ankle_height as { source: string }).source : null,
          cramponCompat: fw.crampon_compat.value,
          cramponCompatSrc:
            fw.crampon_compat.value !== null ? (fw.crampon_compat as { source: string }).source : null,
          waterManagement: fw.water_management.value,
          waterManagementConf:
            fw.water_management.value !== null ? (fw.water_management as { confidence: string }).confidence : null,
          waterManagementSrc:
            fw.water_management.value !== null ? (fw.water_management as { source: string }).source : null,
        },
      });
  }
}

// ---- trip row → StoredTrip ----

function rowToStoredTrip(row: {
  id: string;
  userId: string;
  name: string;
  rawDescription: string | null;
  conditions: Record<string, unknown> | null;
  resultSnapshot: Record<string, unknown> | null;
  createdAt: Date;
}): StoredTrip {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.rawDescription ?? undefined,
    conditions: (row.conditions ?? {}) as TripConditions,
    result: row.resultSnapshot ? (row.resultSnapshot as unknown as RecommendationResult) : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- repository implementation ----

export const postgresRepository: GearRepository = {
  async listItems(userId) {
    const db = getDb();
    // Newest-first to match the memory-repo ordering and the keyset index contract. `listItems` is
    // used by recommend + emergent closet grouping (full-scan); listItemsPage is for paged browsing.
    const rows = await db
      .select()
      .from(items)
      .where(eq(items.userId, userId))
      .orderBy(desc(items.createdAt), desc(items.id));
    return rows.map(rowToStoredItem);
  },

  async listItemsPage(userId, opts: PageOpts): Promise<ItemsPage> {
    const db = getDb();
    const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_PAGE_LIMIT;
    const sort = opts.sort ?? "newest";
    const cur = opts.cursor && sort === "newest" ? decodeCursor(opts.cursor) : null;

    // Build the WHERE predicate. user_id is ALWAYS present — the app-layer scope is the SOLE live
    // tenant isolation (the OWNER connection bypasses RLS; see file header). Additional filter
    // predicates (search, status, condition, domain) are appended with AND.
    const predicates = [eq(items.userId, userId)];

    const searchQuery = opts.search && opts.search.trim() ? opts.search.trim() : null;
    if (searchQuery) {
      // Typo-tolerant fuzzy match: a row qualifies when the whole query string scores above the
      // pg_trgm similarity threshold (0.3) on any of name/brand/model, OR when every whitespace
      // token hits at least one field with a conventional ILIKE (fast path for exact/prefix hits
      // that pg_trgm would also accept but may score marginally).
      // The GIN trigram indexes (items_name_trgm_idx, items_brand_trgm_idx, items_model_trgm_idx)
      // created in migration 0010 allow Postgres to index-scan for similarity() predicates.
      //
      // Recall predicate: (similarity(name,q)>0.3 OR ILIKE) on any field.  This mirrors the
      // core searchScore's typo-tolerance floor without the weighted ranking math (which is
      // approximated by the ORDER BY GREATEST(similarity(...)) below).
      const esc = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
      const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      // Token ILIKE predicates: each token must match at least one of name/brand/model.
      // This ensures "osprey atmos" still requires both words to be present.
      for (const tok of tokens) {
        const pat = `%${esc(tok)}%`;
        predicates.push(
          or(
            ilike(items.name, pat),
            ilike(items.brand, pat),
            ilike(items.model, pat),
            // Trigram similarity fallback for typos: if no field contains the token as a
            // substring, accept it when any field is sufficiently similar to the full query.
            sql`(similarity(${items.name}, ${searchQuery}) > 0.3 OR similarity(${items.brand}, ${searchQuery}) > 0.3 OR similarity(${items.model}, ${searchQuery}) > 0.3)`,
          )!,
        );
      }
    }
    if (opts.status) {
      predicates.push(eq(items.ownershipStatus, opts.status));
    }
    if (opts.condition) {
      predicates.push(eq(items.condition, opts.condition));
    }
    if (opts.domain) {
      // Array membership: `$domain = ANY(items.domains)`
      predicates.push(sql`${opts.domain} = ANY(${items.domains})`);
    }
    if (opts.tag) {
      // Case-insensitive tag membership: any element of user_tags ILIKE the target tag.
      // Uses the GIN index on user_tags via the @> operator after lower-casing both sides.
      const tagLower = opts.tag.trim().toLowerCase();
      predicates.push(sql`lower(${tagLower}) = ANY(SELECT lower(t) FROM unnest(${items.userTags}) AS t)`);
    }
    if (opts.collectionId) {
      // Scope to items in the collection — also verify the collection belongs to this user
      // (a non-owned collectionId must return 0 rows, not all items). We use an EXISTS subquery
      // that checks BOTH the collection_items membership AND the collection's user_id.
      predicates.push(
        sql`EXISTS (
          SELECT 1
          FROM ${collectionItems} ci
          JOIN ${collections} c ON c.id = ci.collection_id
          WHERE ci.item_id = ${items.id}
            AND ci.collection_id = ${opts.collectionId}
            AND c.user_id = ${userId}
        )`,
      );
    }

    // Keyset boundary for newest-first pagination — only when not in search/name-sort modes.
    // In search mode we use OFFSET-style pagination (same as sort==='name') so the relevance
    // ORDER BY is stable across pages. The keyset cursor only applies to the non-search
    // newest-first path.
    if (sort === "newest" && !searchQuery && cur) {
      predicates.push(
        or(
          lt(items.createdAt, cur.createdAt),
          and(eq(items.createdAt, cur.createdAt), lt(items.id, cur.id)),
        )!,
      );
    }

    const whereClause = predicates.length === 1 ? predicates[0]! : and(...predicates)!;

    // OFFSET for search/name-sort modes — extracted from the opaque cursor.
    const offsetBase =
      (searchQuery || sort === "name") && opts.cursor
        ? (() => {
            try {
              return parseInt(Buffer.from(opts.cursor, "base64url").toString("utf8"), 10) || 0;
            } catch {
              return 0;
            }
          })()
        : 0;

    // Fetch limit + 1 to detect whether a further page exists without a second COUNT query.
    // ORDER BY:
    //   - search mode: GREATEST(similarity(name,q), similarity(brand,q), similarity(model,q)) DESC
    //     then created_at DESC, id DESC as tiebreak (matches the in-memory contract).
    //   - name sort: alphabetical by name then id.
    //   - default (newest): created_at DESC, id DESC (keyset path).
    //
    // We build two separate query paths so TypeScript can infer the result type without a
    // complex intermediate annotation; both paths select the same columns from `items`.
    const rows = await (searchQuery
      ? db
          .select()
          .from(items)
          .where(whereClause)
          .orderBy(
            // GREATEST returns the highest similarity score across the three fields — this
            // approximates the core searchScore's per-field weighting without exact numeric parity.
            // coalesce handles NULL brand/model so similarity() never sees a NULL argument.
            sql`GREATEST(
              similarity(${items.name}, ${searchQuery}),
              similarity(coalesce(${items.brand},''), ${searchQuery}),
              similarity(coalesce(${items.model},''), ${searchQuery})
            ) DESC`,
            desc(items.createdAt),
            desc(items.id),
          )
          .limit(limit + 1)
          .offset(offsetBase)
      : db
          .select()
          .from(items)
          .where(whereClause)
          .orderBy(...(sort === "name" ? [asc(items.name), asc(items.id)] : [desc(items.createdAt), desc(items.id)]))
          .limit(limit + 1)
          .offset(sort === "name" ? offsetBase : 0));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    let nextCursor: string | null = null;
    if (hasMore && last) {
      if (searchQuery || sort === "name") {
        // OFFSET-style cursor: encode the new absolute offset as an opaque base64url string.
        // Both the search and name-sort modes use this convention so the UI can call back
        // with the cursor and receive the next chunk at the correct position.
        nextCursor = Buffer.from(String(offsetBase + limit), "utf8").toString("base64url");
      } else {
        nextCursor = encodeCursor(last.createdAt, last.id);
      }
    }

    return { items: page.map(rowToStoredItem), nextCursor };
  },

  async getItem(userId, id) {
    const db = getDb();
    const rows = await db
      .select()
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.id, id)));
    const row = rows[0];
    if (!row) return null;
    return rowToStoredItem(row);
  },

  async addItem(userId, input: AddItemInput) {
    const db = getDb();
    const id = randomUUID();
    const c = input.classification;
    const inv = { ...DEFAULT_INVENTORY, ...(input.inventory ?? {}) };

    const returned = await db
      .insert(items)
      .values({
        id,
        userId,
        name: input.name,
        classification: c,
        inInventory: input.inInventory,
        draft: input.draft ?? false,
        rawText: input.rawText ?? null,
        // Inventory columns (typed; NOT in the classification JSONB):
        ownershipStatus: inv.ownershipStatus,
        quantity: inv.quantity,
        condition: inv.condition ?? null,
        acquiredAt: inv.acquiredAt ?? null,
        pricePaidCents: inv.pricePaidCents ?? null,
        acquiredFrom: inv.acquiredFrom ?? null,
        storageLocation: inv.storageLocation ?? null,
        size: inv.size ?? null,
        color: inv.color ?? null,
        userNotes: inv.userNotes ?? null,
        domains: inv.domains,
        userTags: inv.userTags,
        ...projectIdentity(c),
        ...projectUniversal(c),
        ...projectMultilabel(c),
      })
      .returning();

    const row = returned[0];
    if (!row) throw new Error(`insert returned no row for item ${id}`);

    await upsertGroups(db, id, c);

    return rowToStoredItem(row);
  },

  async updateClassification(userId, id, classification) {
    const db = getDb();
    const c = classification;

    const rows = await db
      .update(items)
      .set({
        name: c.name,
        classification: c,
        ...projectIdentity(c),
        ...projectUniversal(c),
        ...projectMultilabel(c),
      })
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();

    const row = rows[0];
    if (!row) return null;

    await upsertGroups(db, id, c);

    return rowToStoredItem(row);
  },

  async setInventory(userId, id, inInventory) {
    const db = getDb();
    const rows = await db
      .update(items)
      .set({ inInventory })
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return rowToStoredItem(row);
  },

  async setDraft(userId, id, draft) {
    const db = getDb();
    const rows = await db
      .update(items)
      .set({ draft })
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return rowToStoredItem(row);
  },

  async setItemImagePath(userId, id, imagePath) {
    const db = getDb();
    // UPDATE items SET image_path = $imagePath WHERE id = $id AND user_id = $userId RETURNING *.
    // The user_id predicate is the SOLE live tenant isolation (the OWNER connection bypasses RLS), so a
    // non-owned id matches no row → null (no-op). Display-only path (ADR-0018); does not touch the
    // classification jsonb or any typed facet column.
    const rows = await db
      .update(items)
      .set({ imagePath })
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return rowToStoredItem(row);
  },

  async updateItemName(userId, id, name) {
    const db = getDb();
    // Update the `name` hot column AND patch `classification.name` inside the JSONB so both stay in
    // sync — reads reconstruct the display name from the JSONB lossless path, so drifting the two
    // apart causes stale names in the UI. User-scoped: AND user_id = $userId is the SOLE live tenant
    // isolation (OWNER connection bypasses RLS). A non-owned id matches no row → null (no-op).
    const rows = await db
      .update(items)
      .set({
        name,
        // Merge the new name into the existing classification JSONB using Postgres's || operator
        // so we patch only the `name` key without overwriting the rest of the document.
        classification: sql`${items.classification} || jsonb_build_object('name', ${name}::text)`,
      })
      .where(and(eq(items.userId, userId), eq(items.id, id)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return rowToStoredItem(row);
  },

  async updateInventory(userId, id, patch: Partial<InventoryMeta>) {
    const db = getDb();
    // Build a SET clause from only the supplied patch fields so we never overwrite unrelated columns.
    // User-scoped via AND user_id = $userId — the SOLE live tenant isolation (OWNER bypasses RLS).
    // No-op when the item isn't the user's (0 rows updated). Never touches classification or any
    // behavioral facet column.
    const set: Record<string, unknown> = {};
    if ("ownershipStatus" in patch) set.ownershipStatus = patch.ownershipStatus;
    if ("quantity" in patch) set.quantity = patch.quantity;
    if ("condition" in patch) set.condition = patch.condition ?? null;
    if ("acquiredAt" in patch) set.acquiredAt = patch.acquiredAt ?? null;
    if ("pricePaidCents" in patch) set.pricePaidCents = patch.pricePaidCents ?? null;
    if ("acquiredFrom" in patch) set.acquiredFrom = patch.acquiredFrom ?? null;
    if ("storageLocation" in patch) set.storageLocation = patch.storageLocation ?? null;
    if ("size" in patch) set.size = patch.size ?? null;
    if ("color" in patch) set.color = patch.color ?? null;
    if ("userNotes" in patch) set.userNotes = patch.userNotes ?? null;
    if ("domains" in patch) set.domains = patch.domains;
    if ("userTags" in patch) set.userTags = patch.userTags;
    if (Object.keys(set).length === 0) return; // empty patch → no query needed
    await db
      .update(items)
      .set(set)
      .where(and(eq(items.userId, userId), eq(items.id, id)));
  },

  async deleteItem(userId, id) {
    const db = getDb();
    // Group rows + evidence rows are removed by DB cascade (onDelete: "cascade" FKs). Verify the item
    // belongs to this user before deleting to enforce user-scoping.
    await db
      .delete(items)
      .where(and(eq(items.userId, userId), eq(items.id, id)));
  },

  // ---- item evidence (ADR-0012 Element 2) ----

  async replaceItemEvidence(userId, itemId, claims) {
    const db = getDb();
    // User-scope via the parent item: the item_evidence rows carry no user_id, so ownership is gated
    // through the items row — this app-side EXISTS check is the SOLE live isolation (the OWNER
    // connection bypasses RLS; the matching RLS EXISTS-on-parent policy only protects the public
    // PostgREST/anon surface). If the item isn't the user's, do nothing — never delete or write
    // another user's evidence.
    const owner = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.id, itemId)));
    if (!owner[0]) return;

    const rows = claims.map((c) => ({
      itemId,
      facetKey: c.facetKey,
      value: c.value,
      confidence: c.confidence,
      source: c.source,
      sourceUrl: c.sourceUrl ?? null,
      extractorVersion: c.extractorVersion ?? null,
      evidence: c.evidence,
      // observedAt defaults to now() in the column; set it only when the caller provided one.
      ...(c.observedAt ? { observedAt: new Date(c.observedAt) } : {}),
    }));

    // REPLACE semantics: drop the item's existing claim rows, then insert the new full set — atomically
    // so a re-resolution is never observed half-applied.
    await db.transaction(async (tx) => {
      await tx.delete(itemEvidence).where(eq(itemEvidence.itemId, itemId));
      if (rows.length > 0) await tx.insert(itemEvidence).values(rows);
    });
  },

  async getItemEvidence(userId, itemId) {
    const db = getDb();
    // User-scope via the parent item; a non-owned/unknown item reads as empty.
    const owner = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.id, itemId)));
    if (!owner[0]) return [];

    const rows = await db
      .select()
      .from(itemEvidence)
      .where(eq(itemEvidence.itemId, itemId))
      .orderBy(itemEvidence.facetKey, itemEvidence.createdAt);

    return rows.map(
      (r): EvidenceClaim => ({
        facetKey: r.facetKey,
        value: r.value,
        // Columns are plain text/jsonb; narrow to the port's union types at this boundary.
        confidence: r.confidence as EvidenceClaim["confidence"],
        source: r.source as EvidenceClaim["source"],
        sourceUrl: r.sourceUrl,
        extractorVersion: r.extractorVersion,
        evidence: r.evidence,
        observedAt: r.observedAt.toISOString(),
      }),
    );
  },

  // ---- trips ----

  async listTrips(userId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(trips)
      .where(eq(trips.userId, userId))
      .orderBy(trips.createdAt);
    return rows.map(rowToStoredTrip);
  },

  async getTrip(userId, id) {
    const db = getDb();
    const rows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.userId, userId), eq(trips.id, id)));
    const row = rows[0];
    if (!row) return null;
    return rowToStoredTrip(row);
  },

  async saveTrip(userId, input: SaveTripInput) {
    const db = getDb();
    const id = randomUUID();

    const returned = await db
      .insert(trips)
      .values({
        id,
        userId,
        name: input.name,
        rawDescription: input.description ?? null,
        conditions: input.conditions as Record<string, unknown>,
        resultSnapshot: input.result ? (input.result as unknown as Record<string, unknown>) : null,
      })
      .returning();

    const row = returned[0];
    if (!row) throw new Error(`insert returned no row for trip ${id}`);
    return rowToStoredTrip(row);
  },

  async updateTripResult(userId, id, result) {
    const db = getDb();
    const rows = await db
      .update(trips)
      .set({ resultSnapshot: result as unknown as Record<string, unknown> })
      .where(and(eq(trips.userId, userId), eq(trips.id, id)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return rowToStoredTrip(row);
  },

  async renameTrip(userId, id, name) {
    const db = getDb();
    await db
      .update(trips)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(trips.userId, userId), eq(trips.id, id)));
  },

  async updateTripConditions(userId, id, conditions) {
    const db = getDb();
    // Conditions changed → the stored result is stale. Null the snapshot (do NOT auto-replan): the
    // trip reads as unplanned until a re-plan runs against the current closet.
    await db
      .update(trips)
      .set({
        conditions: conditions as unknown as Record<string, unknown>,
        resultSnapshot: null,
        updatedAt: new Date(),
      })
      .where(and(eq(trips.userId, userId), eq(trips.id, id)));
  },

  async cloneTrip(userId, id) {
    const db = getDb();
    // Read the source within the user scope; this WHERE is the SOLE live tenant isolation and is
    // MANDATORY (the OWNER connection bypasses RLS, so the policies are not a live backstop here).
    const sourceRows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.userId, userId), eq(trips.id, id)));
    const source = sourceRows[0];
    if (!source) throw new Error(`trip ${id} not found for user`);

    const newId = randomUUID();
    const returned = await db
      .insert(trips)
      .values({
        id: newId,
        userId,
        name: `${source.name} (copy)`,
        rawDescription: source.rawDescription,
        // Copy real stored conditions only; never fabricate. The result snapshot is intentionally
        // NOT copied — a fresh clone is unplanned until re-planned.
        conditions: source.conditions,
        resultSnapshot: null,
      })
      .returning();

    const row = returned[0];
    if (!row) throw new Error(`insert returned no row for cloned trip ${newId}`);
    return rowToStoredTrip(row);
  },

  async deleteTrip(userId, id) {
    const db = getDb();
    // The result snapshot is a column on the trip row, so deleting the row removes it too — no
    // separate cleanup needed. User-scoped to enforce ownership.
    await db.delete(trips).where(and(eq(trips.userId, userId), eq(trips.id, id)));
  },

  // ---- collections ----

  async createCollection(userId, name) {
    const db = getDb();
    const id = randomUUID();
    const returned = await db
      .insert(collections)
      .values({ id, userId, name })
      .returning();
    const row = returned[0];
    if (!row) throw new Error(`insert returned no row for collection ${id}`);
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      itemCount: 0,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async listCollections(userId) {
    const db = getDb();
    // Fetch collections with their item counts in a single join query. Newest-first via createdAt.
    const rows = await db
      .select({
        id: collections.id,
        userId: collections.userId,
        name: collections.name,
        createdAt: collections.createdAt,
        itemCount: count(collectionItems.itemId),
      })
      .from(collections)
      .leftJoin(collectionItems, eq(collectionItems.collectionId, collections.id))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id)
      .orderBy(desc(collections.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      itemCount: Number(r.itemCount),
      createdAt: r.createdAt.toISOString(),
    }));
  },

  async renameCollection(userId, id, name) {
    const db = getDb();
    await db
      .update(collections)
      .set({ name })
      .where(and(eq(collections.userId, userId), eq(collections.id, id)));
  },

  async deleteCollection(userId, id) {
    const db = getDb();
    // The collection_items rows are removed by DB cascade (onDelete: "cascade" FK). Items themselves
    // are NOT deleted — only the membership rows. User-scoped via AND user_id = $userId.
    await db
      .delete(collections)
      .where(and(eq(collections.userId, userId), eq(collections.id, id)));
  },

  async addItemToCollection(userId, collectionId, itemId) {
    const db = getDb();
    // Verify BOTH the collection and the item belong to this user before inserting. A non-owned id
    // on either side is a silent no-op — the ownership checks are the SOLE live tenant isolation.
    const [collOwner, itemOwner] = await Promise.all([
      db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.userId, userId), eq(collections.id, collectionId))),
      db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.userId, userId), eq(items.id, itemId))),
    ]);
    if (!collOwner[0] || !itemOwner[0]) return;

    // Idempotent: ON CONFLICT DO NOTHING — a duplicate add is silently ignored.
    await db
      .insert(collectionItems)
      .values({ collectionId, itemId })
      .onConflictDoNothing();
  },

  async removeItemFromCollection(userId, collectionId, itemId) {
    const db = getDb();
    // Verify collection ownership before deleting the membership row. A non-owned collection id
    // silently does nothing — the user-scoped check is the SOLE live tenant isolation.
    const collOwner = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.userId, userId), eq(collections.id, collectionId)));
    if (!collOwner[0]) return;

    await db
      .delete(collectionItems)
      .where(and(eq(collectionItems.collectionId, collectionId), eq(collectionItems.itemId, itemId)));
  },

  async listCollectionItemIds(userId, collectionId) {
    const db = getDb();
    // Verify collection ownership; return [] for non-owned or empty collections.
    const collOwner = await db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.userId, userId), eq(collections.id, collectionId)));
    if (!collOwner[0]) return [];

    const rows = await db
      .select({ itemId: collectionItems.itemId })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, collectionId))
      .orderBy(desc(collectionItems.addedAt));

    return rows.map((r) => r.itemId);
  },

  async collectionsForItem(userId, itemId) {
    const db = getDb();
    // Verify item ownership; return [] if the item isn't the user's.
    const itemOwner = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.userId, userId), eq(items.id, itemId)));
    if (!itemOwner[0]) return [];

    // 1. Find all collection ids that contain this item, user-scoped.
    const memberRows = await db
      .select({ collectionId: collectionItems.collectionId })
      .from(collectionItems)
      .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
      .where(
        and(
          eq(collectionItems.itemId, itemId),
          eq(collections.userId, userId),
        ),
      );

    if (memberRows.length === 0) return [];
    const collIds = memberRows.map((r) => r.collectionId);

    // 2. Fetch those collections with full item counts.
    const rows = await db
      .select({
        id: collections.id,
        userId: collections.userId,
        name: collections.name,
        createdAt: collections.createdAt,
        itemCount: count(collectionItems.itemId),
      })
      .from(collections)
      .leftJoin(collectionItems, eq(collectionItems.collectionId, collections.id))
      .where(inArray(collections.id, collIds))
      .groupBy(collections.id)
      .orderBy(desc(collections.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      itemCount: Number(r.itemCount),
      createdAt: r.createdAt.toISOString(),
    }));
  },

  // ---- account / data deletion ----

  async deleteAllUserData(userId) {
    const db = getDb();
    // Permanently wipe EVERY user_id-scoped row this user owns. Every statement carries
    // `WHERE user_id = $userId` — the SOLE live tenant isolation (the OWNER connection bypasses RLS),
    // so this can never reach another tenant's rows. Wrapped in a transaction so a partial wipe is never
    // observed. Child rows of `items` (item_insulation/sleep/shell/carry/footwear, item_treatments,
    // pending_facets, item_evidence, collection_items) and of `collections` (collection_items) are
    // removed by the schema's ON DELETE CASCADE FKs when the parent rows go — but we ALSO delete the
    // independently user_id-scoped tables (trips, collections, pending_facets, user_overrides) explicitly
    // and safely. Order: delete the user_id-scoped tables, then `items` LAST so its cascade fans out to
    // every remaining child. pending_facets is deleted explicitly by user_id (it carries one) AND would
    // also cascade from items where item_id is set — belt and suspenders.
    await db.transaction(async (tx) => {
      // Per-user classification cache overrides (the only per-user cache table; the shared llm_draft_cache
      // has no user_id and is global, so it is intentionally NOT touched).
      await tx.delete(userOverrides).where(eq(userOverrides.userId, userId));
      // Trips (and their result snapshots, which live on the trip row).
      await tx.delete(trips).where(eq(trips.userId, userId));
      // Novel facet extractions parked for review (user_id-scoped).
      await tx.delete(pendingFacets).where(eq(pendingFacets.userId, userId));
      // Collections — cascades collection_items membership rows for the user's collections.
      await tx.delete(collections).where(eq(collections.userId, userId));
      // Items LAST — cascades the domain-group rows, item_treatments, item_evidence, any remaining
      // collection_items (via item FK), and pending_facets referencing those items.
      await tx.delete(items).where(eq(items.userId, userId));
    });
  },
};
