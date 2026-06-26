import { searchCloset, isItemGear } from "@/server/app-service";
import { getSignedItemImageUrls } from "@/server/item-images";
import { deriveDisplayTags } from "@/core/tags";
import { GROUPINGS, GROUPING_LABELS, type GroupingKey } from "@/core/closet";
import { OWNERSHIP_STATUS, CONDITION, type OwnershipStatus, type Condition } from "@/core/inventory";
import { getUserIdOrGuest } from "@/lib/auth";
import { ClosetView } from "@/components/ClosetView";
import { GuestBanner } from "@/components/GuestBanner";
import {
  recordOwnershipAction,
  renameItemAction,
  updateInventoryAction,
  deleteItemAction,
  loadMoreClosetAction,
  bulkUpdateClosetAction,
  suggestItemsAction,
  searchCatalogAction,
  addFromCatalogAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: {
    group?: string;
    q?: string;
    status?: string;
    condition?: string;
    sort?: string;
    view?: string;
    error?: string;
    dup?: string;
    dupId?: string;
    tag?: string;
  };
}) {
  // READ gate — never redirects. A guest (auth configured, no session) is served the seeded SAMPLE closet
  // from the in-memory repo; add/edit remain write-gated behind requireUserId() in the actions.
  const { userId, isGuest } = await getUserIdOrGuest();

  // DEFAULT = "all" → a flat grid of every item. A grouping dimension is the optional toggle.
  const rawGroup = searchParams.group ?? "all";
  const grouped = (GROUPINGS as readonly string[]).includes(rawGroup);
  const dimension: GroupingKey = grouped ? (rawGroup as GroupingKey) : "capability";

  // Optional name/brand/model search query — trimmed, empty = no filter.
  const searchQ = (searchParams.q ?? "").trim();

  // Filter + sort controls
  const statusRaw = searchParams.status ?? "";
  const conditionRaw = searchParams.condition ?? "";
  const sortRaw = searchParams.sort ?? "";

  const activeStatus: OwnershipStatus | undefined = (OWNERSHIP_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as OwnershipStatus)
    : undefined;
  const activeCondition: Condition | undefined = (CONDITION as readonly string[]).includes(conditionRaw)
    ? (conditionRaw as Condition)
    : undefined;
  const activeSort: "newest" | "name" = sortRaw === "name" ? "name" : "newest";

  // View toggle: grid (default) or list
  const activeView = searchParams.view === "list" ? "list" : "grid";

  // Tag filter — from ?tag= query param (set by clicking a tag chip)
  const activeTag = (searchParams.tag ?? "").trim() || undefined;

  // First page — limit 36 for the grid SSR; grouped views use a generous fetch (no pagination)
  const pageLimit = grouped ? 200 : 36;

  const { items, groups, nextCursor } = await searchCloset(
    dimension,
    {
      search: searchQ || undefined,
      status: activeStatus,
      condition: activeCondition,
      tag: activeTag,
      sort: activeSort,
      limit: pageLimit,
    },
    userId,
  );

  // Batch-sign every item's private photo path in ONE round-trip (ADR-0018 §D).
  const signedUrls = await getSignedItemImageUrls(items.map((it) => it.imagePath ?? null));

  // Map items to the summary shape ClosetView expects — no core imports in the page.
  const itemSummaries = items.map((it) => {
    const tags = deriveDisplayTags(it.classification.universal);
    return {
      id: it.id,
      name: it.name,
      badges: tags.slice(0, 4).map((t) => t.label),
      imageUrl: it.imagePath ? (signedUrls.get(it.imagePath) ?? null) : null,
      needsVerify:
        it.classification.universal.warmth.value === null &&
        it.classification.universal.technical_vs_lifestyle.value === null,
      // Inventory surface fields for the card
      ownershipStatus: it.inventory.ownershipStatus,
      quantity: it.inventory.quantity,
      condition: it.inventory.condition,
      isRecordOnly: it.inventory.domains.length === 0 && tags.length === 0,
      // Domain-gating: true = full gear UI; false = possession/record treatment
      isGear: isItemGear(it),
      // User-curated tags for clickable tag filter
      userTags: it.inventory.userTags,
    };
  });

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
      {searchParams.error && (
        <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
          {searchParams.error}
        </p>
      )}
      <ClosetView
        items={itemSummaries}
        groups={groupSummaries}
        activeGroup={grouped ? dimension : "all"}
        groupingLinks={groupingLinks}
        searchQ={searchQ}
        activeStatus={activeStatus}
        activeCondition={activeCondition}
        activeSort={activeSort}
        activeView={activeView}
        activeTag={activeTag}
        nextCursor={grouped ? null : (nextCursor ?? null)}
        isGuest={isGuest}
        recordOwnershipAction={recordOwnershipAction}
        renameItemAction={renameItemAction}
        updateInventoryAction={updateInventoryAction}
        deleteItemAction={deleteItemAction}
        loadMoreAction={loadMoreClosetAction}
        bulkUpdateAction={bulkUpdateClosetAction}
        suggestItemsAction={suggestItemsAction}
        searchCatalogAction={searchCatalogAction}
        addFromCatalogAction={addFromCatalogAction}
        dupName={searchParams.dup}
        dupId={searchParams.dupId}
      />
    </div>
  );
}
