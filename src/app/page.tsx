import { searchCloset } from "@/server/app-service";
import { getSignedItemImageUrls } from "@/server/item-images";
import { deriveDisplayTags } from "@/core/tags";
import { GROUPINGS, GROUPING_LABELS, type GroupingKey } from "@/core/closet";
import { getUserIdOrGuest } from "@/lib/auth";
import { ClosetView } from "@/components/ClosetView";
import { GuestBanner } from "@/components/GuestBanner";
import { recordOwnershipAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ClosetPage({
  searchParams,
}: {
  searchParams: { group?: string; q?: string; error?: string };
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

  const { items, groups } = await searchCloset(dimension, { search: searchQ || undefined }, userId);

  // Batch-sign every item's private photo path in ONE round-trip (ADR-0018 §D).
  const signedUrls = await getSignedItemImageUrls(items.map((it) => it.imagePath ?? null));

  // Map items to the summary shape ClosetView expects — no core imports in the page.
  const itemSummaries = items.map((it) => ({
    id: it.id,
    name: it.name,
    badges: deriveDisplayTags(it.classification.universal).slice(0, 4).map((t) => t.label),
    imageUrl: it.imagePath ? (signedUrls.get(it.imagePath) ?? null) : null,
    needsVerify:
      it.classification.universal.warmth.value === null &&
      it.classification.universal.technical_vs_lifestyle.value === null,
    // Inventory surface fields for the card
    ownershipStatus: it.inventory.ownershipStatus,
    quantity: it.inventory.quantity,
    condition: it.inventory.condition,
    // Record-only = domains empty (no behavioral facets classified yet)
    isRecordOnly: it.inventory.domains.length === 0 && deriveDisplayTags(it.classification.universal).length === 0,
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
        isGuest={isGuest}
        recordOwnershipAction={recordOwnershipAction}
      />
    </div>
  );
}
