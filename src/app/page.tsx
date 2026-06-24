import { getCloset } from "@/server/app-service";
import { GROUPINGS, GROUPING_LABELS, type GroupingKey } from "@/core/closet";
import { getUserIdOrGuest } from "@/lib/auth";
import { ClosetView } from "@/components/ClosetView";
import { GuestBanner } from "@/components/GuestBanner";

export const dynamic = "force-dynamic";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: { group?: string };
}) {
  // READ gate — never redirects. A guest (auth configured, no session) is served the seeded SAMPLE closet
  // from the in-memory repo; add/edit remain write-gated behind requireUserId() in the actions.
  const { userId, isGuest } = await getUserIdOrGuest();

  // DEFAULT = "all" → a flat grid of every item. A grouping dimension is the optional toggle.
  const rawGroup = searchParams.group ?? "all";
  const grouped = (GROUPINGS as readonly string[]).includes(rawGroup);
  // When ungrouped, the dimension is irrelevant to rendering; pass capability so the service still resolves
  // a valid groups payload (unused by the flat view).
  const dimension: GroupingKey = grouped ? (rawGroup as GroupingKey) : "capability";

  const { items, groups } = await getCloset(dimension, userId);

  // Map items to the summary shape ClosetView expects — no core imports in the page.
  const itemSummaries = items.map((it) => ({
    id: it.id,
    name: it.name,
    badges: it.classification.multilabel.function_purpose.slice(0, 3),
    // Surface "verify" honestly: items whose universal facets are unknown (the recommender's
    // blocked_unknown/uncertain space) — we do not hide them.
    needsVerify:
      it.classification.universal.warmth.value === null &&
      it.classification.universal.technical_vs_lifestyle.value === null,
  }));

  // "All" leads; the emergent facet dimensions follow. Never fixed category tabs.
  const groupingLinks = [
    { key: "all", label: "All" },
    ...GROUPINGS.map((g) => ({ key: g, label: GROUPING_LABELS[g] })),
  ];

  const groupSummaries = groups.map((g) => ({
    key: g.key,
    label: g.label,
    itemIds: g.itemIds,
  }));

  return (
    <div className="space-y-8">
      {isGuest && <GuestBanner />}
      <ClosetView
        items={itemSummaries}
        groups={groupSummaries}
        activeGroup={grouped ? dimension : "all"}
        groupingLinks={groupingLinks}
      />
    </div>
  );
}
