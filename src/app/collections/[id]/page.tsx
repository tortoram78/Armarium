import { notFound } from "next/navigation";
import Link from "next/link";
import { searchCloset, listCollections, isItemGear } from "@/server/app-service";
import { deriveDisplayTags } from "@/core/tags";
import { getUserIdOrGuest } from "@/lib/auth";
import { getSignedItemImageUrls } from "@/server/item-images";
import { removeItemFromCollectionRedirectAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CollectionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { userId, isGuest } = await getUserIdOrGuest();

  // Fetch the collection's items. searchCloset with collectionId filter.
  // Also need the collection name — listCollections gives us that.
  const [collections, { items }] = await Promise.all([
    listCollections(userId),
    searchCloset("capability", { collectionId: params.id, limit: 200 }, userId),
  ]);

  const collection = collections.find((c) => c.id === params.id);
  // If the collection doesn't exist (or belongs to another user), 404.
  if (!collection) notFound();

  // Batch-sign photos in one round-trip.
  const signedUrls = await getSignedItemImageUrls(items.map((it) => it.imagePath ?? null));

  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <Link
        href="/collections"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Collections
      </Link>

      {/* Masthead */}
      <header className="space-y-2">
        <p className="eyebrow">Collection</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="display-xl text-foreground">{collection.name}</h1>
            <p className="mt-3 text-[0.975rem] text-muted-foreground">
              <span className="data-mono text-foreground">{items.length}</span>{" "}
              {items.length === 1 ? "item" : "items"}
            </p>
          </div>
          <Link
            href="/collections"
            className={[
              "inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-4 py-2",
              "text-sm font-medium text-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
              "transition-colors hover:bg-secondary",
            ].join(" ")}
          >
            All collections
          </Link>
        </div>
      </header>

      {/* Item grid */}
      {items.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <FolderOpen className="mb-4 h-8 w-8 text-muted-foreground/40" aria-hidden />
          <h2 className="display-md text-foreground">Empty collection</h2>
          <p className="mt-2 max-w-sm text-[0.9rem] leading-relaxed text-muted-foreground">
            Add items to this collection from their detail pages using the &ldquo;Add to collection&rdquo;
            control.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors hover:bg-secondary"
          >
            Browse closet
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const tags = deriveDisplayTags(it.classification.universal);
            const imageUrl = it.imagePath ? (signedUrls.get(it.imagePath) ?? null) : null;
            const isGear = isItemGear(it);
            const isRecordOnly = it.inventory.domains.length === 0 && tags.length === 0;

            return (
              <div key={it.id} className="relative group">
                <Link
                  href={`/items/${it.id}`}
                  className="panel panel-hover flex h-full flex-col overflow-hidden"
                >
                  {imageUrl && (
                    <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={it.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 ease-crisp group-hover:scale-[1.03]"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <h3 className="subhead text-[0.975rem] leading-snug text-foreground transition-colors group-hover:text-primary">
                      {it.name}
                    </h3>
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                      {isRecordOnly ? (
                        <span className="text-xs italic text-muted-foreground/60">details pending</span>
                      ) : !isGear ? (
                        <span className="text-xs italic text-muted-foreground/60">not yet classified</span>
                      ) : tags.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground/70">no facets yet</span>
                      ) : (
                        tags.slice(0, 4).map((t) => (
                          <Badge key={t.label} variant="subtle">
                            {t.label.replace(/_/g, " ")}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </Link>

                {/* Remove from collection affordance — write-gated, shown on hover */}
                {!isGuest && (
                  <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <form action={removeItemFromCollectionRedirectAction}>
                      <input type="hidden" name="collectionId" value={params.id} />
                      <input type="hidden" name="itemId" value={it.id} />
                      <button
                        type="submit"
                        className={[
                          "flex h-7 items-center gap-1 rounded border border-border bg-card/90 px-2 backdrop-blur-sm",
                          "text-[0.75rem] text-muted-foreground shadow-sm",
                          "transition-colors hover:bg-destructive/8 hover:text-destructive hover:border-destructive/30",
                        ].join(" ")}
                        title="Remove from collection"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
