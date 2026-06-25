import type { ResolvedItem } from "@/core/resolved";
import type { UniversalFacets, MultiLabelFacets, FacetGroups } from "@/core/classification";
import { UNKNOWN_SOFT as us, UNKNOWN_HARD as uh } from "@/core/evidence";
import { DEFAULT_INVENTORY } from "@/core/inventory";

export const s = <T>(
  value: T,
  confidence: "low" | "medium" | "high",
  source: "manufacturer" | "user" | "inferred" | "derived_from_material",
  evidence: string,
) => ({ value, confidence, source, evidence });

export const h = <T>(value: T, source: "manufacturer" | "user", evidence: string) => ({ value, source, evidence });

function universalDefaults(): UniversalFacets {
  return {
    waterproofness: us, wind_resistance: us, breathability: us, moisture_management: us,
    dry_speed: us, warmth_when_wet: us, warmth: us, packability: us, technical_vs_lifestyle: us, upf: uh,
  };
}
function multilabelDefaults(): MultiLabelFacets {
  return { layering_role: [], function_purpose: [], body_zone_covered: [], activity_fit: [], conditions_fit: [] };
}

export function mkResolved(
  id: string,
  name: string,
  u: Partial<UniversalFacets> = {},
  m: Partial<MultiLabelFacets> = {},
  groups: FacetGroups = {},
): ResolvedItem {
  return {
    id, name,
    universal: { ...universalDefaults(), ...u },
    multilabel: { ...multilabelDefaults(), ...m },
    groups,
    inventory: DEFAULT_INVENTORY,
  };
}
