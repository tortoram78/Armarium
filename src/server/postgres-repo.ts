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

import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@/db/client";
import {
  items,
  itemInsulation,
  itemSleep,
  itemShell,
  itemCarry,
  itemFootwear,
} from "@/db/schema";
import type {
  GearRepository,
  StoredItem,
  StoredTrip,
  AddItemInput,
  SaveTripInput,
} from "@/core/ports";
import type { ItemClassification } from "@/core/classification";
import type { TripConditions } from "@/core/conditions";
import type { RecommendationResult } from "@/core/recommend";
import { trips } from "@/db/schema";

// ---- lazy singleton DB client ----

let _db: Db | null = null;

function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — cannot use the Postgres repository. " +
        "Set DATABASE_URL in your environment or use the in-memory repository."
    );
  }
  _db = createDb(url);
  return _db;
}

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
  classification: ItemClassification;
  createdAt: Date;
}): StoredItem {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    inInventory: row.inInventory,
    draft: row.draft,
    rawText: row.rawText ?? undefined,
    classification: row.classification,
    createdAt: row.createdAt.toISOString(),
  };
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
    const rows = await db
      .select()
      .from(items)
      .where(eq(items.userId, userId))
      .orderBy(items.createdAt);
    return rows.map(rowToStoredItem);
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

  async deleteItem(userId, id) {
    const db = getDb();
    // Group rows are removed by DB cascade (onDelete: "cascade" FKs). Verify the item belongs to
    // this user before deleting to enforce user-scoping.
    await db
      .delete(items)
      .where(and(eq(items.userId, userId), eq(items.id, id)));
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
};
