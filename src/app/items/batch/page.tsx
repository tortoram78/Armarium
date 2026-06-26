import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getItem } from "@/server/app-service";
import { recordOwnershipBatchAction, enrichItemAction } from "@/app/actions";
import { BatchEnrichView } from "@/components/BatchEnrichView";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * GET (no ?ids): show the paste-a-list form.
 * GET (?ids=<csv>): seed the BatchEnrichView with the just-created items, which enriches each
 * client-side with a small concurrency cap.
 */
export default async function BatchPage({
  searchParams,
}: {
  searchParams: { ids?: string; error?: string };
}) {
  // Always write-gated — guest cannot batch-add
  const userId = await requireUserId();

  // ── ?ids view: streaming enrichment ──────────────────────────────────────────────────────────────
  if (searchParams.ids) {
    const rawIds = searchParams.ids.split(",").map((s) => s.trim()).filter(Boolean);
    if (rawIds.length === 0) redirect("/items/batch");

    // Fetch the just-created items (they are owned, non-draft, in the closet)
    const settled = await Promise.all(rawIds.map((id) => getItem(id, userId)));
    const seedItems = settled
      .filter((i): i is NonNullable<typeof i> => i !== null)
      .map((i) => ({ id: i.id, name: i.name }));

    if (seedItems.length === 0) redirect("/items/batch");

    return (
      <div className="mx-auto max-w-2xl space-y-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden>&larr;</span> Closet
        </Link>

        <header className="space-y-3">
          <p className="eyebrow">Batch add</p>
          <h1 className="display-xl text-foreground">Classifying your gear</h1>
          <p className="text-[0.975rem] leading-relaxed text-muted-foreground">
            All {seedItems.length} {seedItems.length === 1 ? "item" : "items"} are already in your
            closet. Details are filling in now — you can leave this page at any time.
          </p>
        </header>

        <BatchEnrichView items={seedItems} enrichAction={enrichItemAction} />
      </div>
    );
  }

  // ── GET form view ─────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Closet
      </Link>

      <header className="space-y-3">
        <p className="eyebrow">Batch add</p>
        <h1 className="display-xl text-foreground">Paste a list</h1>
        <p className="text-[0.975rem] leading-relaxed text-muted-foreground">
          Paste one item name (or manufacturer URL) per line. All items appear in your closet
          instantly — Armarium then fills in the details in the background.
        </p>
      </header>

      {searchParams.error && (
        <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
          {searchParams.error}
        </p>
      )}

      <form action={recordOwnershipBatchAction} className="space-y-5">
        <div className="space-y-2">
          <label
            htmlFor="names"
            className="block text-sm font-medium text-foreground"
          >
            Items — one per line
          </label>
          <Textarea
            id="names"
            name="names"
            rows={12}
            placeholder={"Patagonia Nano Puff Jacket\nBlack Diamond Spot Headlamp\nMSR Hubba NX tent\nhttps://www.rei.com/product/123456/example"}
            autoFocus
            className="resize-none font-mono text-sm"
          />
          <p className="text-[0.8rem] text-muted-foreground/70">
            Duplicates within the paste are merged automatically. Blank lines are ignored.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" className="px-6">
            Add all
          </Button>
          <Link
            href="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
