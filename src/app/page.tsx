import { getCloset } from "@/server/app-service";
import { GROUPINGS, GROUPING_LABELS, type GroupingKey } from "@/core/closet";
import { requireUserId } from "@/lib/auth";
import { ClosetView } from "@/components/ClosetView";

export const dynamic = "force-dynamic";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: { group?: string };
}) {
  const userId = await requireUserId();
  const dimension: GroupingKey = (GROUPINGS as readonly string[]).includes(
    searchParams.group ?? "",
  )
    ? (searchParams.group as GroupingKey)
    : "capability";

  const { items, byId, groups } = await getCloset(dimension, userId);

  // Map items to the summary shape ClosetView expects — no core imports in the page.
  const itemSummaries = items.map((it) => ({
    id: it.id,
    name: it.name,
    badges: it.classification.multilabel.function_purpose.slice(0, 3),
    // Surface "verify" state: items with low-confidence universal facets or unknown classification
    needsVerify: it.classification.universal.warmth.value === null &&
      it.classification.universal.technical_vs_lifestyle.value === null,
  }));

  const groupingLinks = GROUPINGS.map((g) => ({
    key: g,
    label: GROUPING_LABELS[g],
  }));

  // Map groups to the shape ClosetView expects
  const groupSummaries = groups.map((g) => ({
    key: g.key,
    label: g.label,
    itemIds: g.itemIds,
  }));

  return (
    <ClosetView
      items={itemSummaries}
      groups={groupSummaries}
      dimension={dimension}
      groupingLinks={groupingLinks}
    />
  );
}
