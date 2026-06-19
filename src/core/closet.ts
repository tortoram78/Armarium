// Emergent closet grouping — "categories" expressed as QUERIES over the facet space, never stored
// buckets. The same item legitimately appears in several groups (that is the whole point). The Closet
// UI picks a grouping dimension; this returns the groups. Adding a new way to view the closet = adding
// a query here, not a schema change.

import type { ResolvedItem } from "./resolved";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS, type CapabilityKey } from "./capabilities";
import { LAYERING_ROLE, WARMTH, TECH_LIFESTYLE, BODY_ZONE } from "./facets/levels";

export const GROUPINGS = ["capability", "layering_role", "warmth", "technical_vs_lifestyle", "body_zone"] as const;
export type GroupingKey = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<GroupingKey, string> = {
  capability: "What it can do",
  layering_role: "Layering role",
  warmth: "Warmth",
  technical_vs_lifestyle: "Technical ↔ lifestyle",
  body_zone: "Body zone",
};

export interface ClosetGroup {
  key: string;
  label: string;
  itemIds: string[];
}

const titleize = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function groupCloset(items: ResolvedItem[], dimension: GroupingKey): ClosetGroup[] {
  switch (dimension) {
    case "capability": {
      // An item is in a capability group iff it SATISFIES that capability (blocked/fails excluded).
      return CAPABILITY_KEYS.map((cap: CapabilityKey) => ({
        key: cap,
        label: CAPABILITY_LABELS[cap],
        itemIds: items.filter((it) => evaluateCapability(it, cap) === "satisfies").map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
    }
    case "layering_role": {
      return LAYERING_ROLE.map((role) => ({
        key: role,
        label: titleize(role),
        itemIds: items.filter((it) => it.multilabel.layering_role.includes(role)).map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
    }
    case "body_zone": {
      return BODY_ZONE.map((zone) => ({
        key: zone,
        label: titleize(zone),
        itemIds: items.filter((it) => it.multilabel.body_zone_covered.includes(zone)).map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
    }
    case "warmth": {
      return scalarGroups(items, WARMTH, (it) => it.universal.warmth.value);
    }
    case "technical_vs_lifestyle": {
      return scalarGroups(items, TECH_LIFESTYLE, (it) => it.universal.technical_vs_lifestyle.value);
    }
  }
}

function scalarGroups<const T extends readonly string[]>(
  items: ResolvedItem[],
  scale: T,
  read: (it: ResolvedItem) => string | null,
): ClosetGroup[] {
  const groups: ClosetGroup[] = scale.map((level) => ({
    key: level,
    label: titleize(level),
    itemIds: items.filter((it) => read(it) === level).map((it) => it.id),
  }));
  const unknown = items.filter((it) => read(it) === null).map((it) => it.id);
  if (unknown.length) groups.push({ key: "unknown", label: "Unknown (verify)", itemIds: unknown });
  return groups.filter((g) => g.itemIds.length > 0);
}
