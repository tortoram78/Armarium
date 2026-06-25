// Emergent closet grouping — "categories" expressed as QUERIES over the facet space, never stored
// buckets. The same item legitimately appears in several groups (that is the whole point). The Closet
// UI picks a grouping dimension; this returns the groups. Adding a new way to view the closet = adding
// a query here, not a schema change.
//
// Every grouping appends a trailing "Unclassified — add details" bucket for items that have no gear
// facets (record-only / possession items). These items currently have no facet presence and would
// otherwise vanish from every grouped view. The bucket is honest: it is not a hardcoded category —
// it is an "everything else" catch-all that disappears when the closet is empty of such items.

import type { ResolvedItem } from "./resolved";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS, type CapabilityKey } from "./capabilities";
import { LAYERING_ROLE, WARMTH, TECH_LIFESTYLE, BODY_ZONE } from "./facets/levels";
import { isGearClassified } from "./domains";

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

/** The canonical unclassified bucket appended to every grouped view. */
const UNCLASSIFIED_KEY = "unclassified";
const UNCLASSIFIED_LABEL = "Unclassified — add details";

/**
 * Append an "Unclassified — add details" group for record-only items (no gear facets) to any
 * array of groups. The bucket is omitted when empty, so pure-classified closets are unaffected.
 * Items in the bucket cannot appear in the facet/capability groups above (they have no facets),
 * so there is no double-counting.
 */
function withUnclassified(groups: ClosetGroup[], items: ResolvedItem[]): ClosetGroup[] {
  const unclassifiedIds = items
    .filter((it) => !isGearClassified(it))
    .map((it) => it.id);
  if (unclassifiedIds.length === 0) return groups;
  return [...groups, { key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL, itemIds: unclassifiedIds }];
}

export function groupCloset(items: ResolvedItem[], dimension: GroupingKey): ClosetGroup[] {
  switch (dimension) {
    case "capability": {
      // An item is in a capability group iff it SATISFIES that capability (blocked/fails excluded).
      const groups = CAPABILITY_KEYS.map((cap: CapabilityKey) => ({
        key: cap,
        label: CAPABILITY_LABELS[cap],
        itemIds: items.filter((it) => evaluateCapability(it, cap) === "satisfies").map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
      return withUnclassified(groups, items);
    }
    case "layering_role": {
      const groups = LAYERING_ROLE.map((role) => ({
        key: role,
        label: titleize(role),
        itemIds: items.filter((it) => it.multilabel.layering_role.includes(role)).map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
      return withUnclassified(groups, items);
    }
    case "body_zone": {
      const groups = BODY_ZONE.map((zone) => ({
        key: zone,
        label: titleize(zone),
        itemIds: items.filter((it) => it.multilabel.body_zone_covered.includes(zone)).map((it) => it.id),
      })).filter((g) => g.itemIds.length > 0);
      return withUnclassified(groups, items);
    }
    case "warmth": {
      return withUnclassified(scalarGroups(items, WARMTH, (it) => it.universal.warmth.value), items);
    }
    case "technical_vs_lifestyle": {
      return withUnclassified(scalarGroups(items, TECH_LIFESTYLE, (it) => it.universal.technical_vs_lifestyle.value), items);
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
