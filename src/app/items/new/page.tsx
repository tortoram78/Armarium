import { addItemAction, enrichFromUrlAction } from "@/app/actions";
import { getClassifier } from "@/server/services";
import { SubmitButton } from "@/components/SubmitButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function NewItemPage({ searchParams }: { searchParams: { error?: string; name?: string } }) {
  const mode = getClassifier().mode;
  return (
    <div className="mx-auto max-w-2xl space-y-12">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Closet
      </Link>

      {/* ── Masthead ── */}
      <header className="max-w-xl">
        <p className="eyebrow mb-3">Add gear</p>
        <h1 className="display-xl text-foreground">Add an item</h1>
        <p className="mt-4 text-[0.975rem] leading-relaxed text-muted-foreground">
          Name a piece of gear and Armarium classifies it onto the facets — or pull authoritative specs
          straight from a manufacturer&apos;s product page. Either way you review before it&apos;s saved.
          {mode === "offline" && (
            <span className="text-accent">
              {" "}
              Offline classifier active (no API key) — only the prototype corpus is recognized.
            </span>
          )}
        </p>
      </header>

      {/* ── Path 1: Add by name ── */}
      <section className="panel p-6 sm:p-7">
        <div className="mb-5">
          <h2 className="display-md text-foreground">By name</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Enter a product name and add anything you already know. The classifier reasons it onto the
            facet ontology, then hands you the result to review and correct.
          </p>
        </div>
        <form action={addItemAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name">Item name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={searchParams.name ?? ""}
              placeholder="e.g. Arc'teryx Beta AR Jacket"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="text">Known details (optional)</Label>
            <Textarea
              id="text"
              name="text"
              placeholder="Composition, weight, membrane/DWR, fill, etc. — anything you know."
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              name="inInventory"
              defaultChecked
              className="h-4 w-4 rounded-sm border-input accent-primary"
            />
            Add to my inventory (uncheck for catalog only)
          </label>
          {searchParams.error ? (
            <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
              {searchParams.error}
            </p>
          ) : null}
          <div className="pt-1">
            <SubmitButton pendingText="Classifying…">Classify &amp; review</SubmitButton>
          </div>
        </form>
      </section>

      {/* ── Divider ── */}
      <div className="flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="eyebrow">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* ── Path 2: Add by manufacturer URL ── */}
      <section className="panel p-6 sm:p-7">
        <div className="mb-5">
          <h2 className="display-md text-foreground">By manufacturer URL</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
            Paste an official product page and we read the composition, brand, model, price and weight
            from it. These authoritative facts out-rank inference.
          </p>
        </div>
        <form action={enrichFromUrlAction} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="url">Manufacturer product URL</Label>
            <Input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              placeholder="https://www.patagonia.com/product/…"
              required
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Supported manufacturers: Patagonia, Arc&apos;teryx, REI, The North Face, Black Diamond,
              Marmot.
            </p>
          </div>
          <div className="pt-1">
            <SubmitButton pendingText="Fetching…">Fetch &amp; classify</SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
