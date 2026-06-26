import { addItemAction, searchCatalogAction, addFromCatalogAction } from "@/app/actions";
import { getClassifier } from "@/server/services";
import { SubmitButton } from "@/components/SubmitButton";
import { CatalogNameField } from "@/components/CatalogNameField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import Link from "next/link";

export const dynamic = "force-dynamic";
// The add flow can run a slow tier: a residential proxy fetch and/or a Claude web-search lookup (each up
// to ~20-30s). Raise the serverless function ceiling so the action completes instead of timing out at the
// ~10-15s default. (Vercel Hobby allows up to 60s.)
export const maxDuration = 60;

export default function NewItemPage({
  searchParams,
}: {
  searchParams: { error?: string; name?: string; text?: string; url?: string };
}) {
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
          Name the gear, paste a manufacturer link if you have one, and add anything else you know.
          Armarium pulls authoritative specs from the link when it can and classifies the rest onto the
          facets — you review before it&apos;s saved.
          {mode === "offline" && (
            <span className="text-accent">
              {" "}
              Offline classifier active (no API key) — only the prototype corpus is recognized.
            </span>
          )}
        </p>
      </header>

      {/* ── One pane: name + link + details ── */}
      <section className="panel p-6 sm:p-7">
        <form action={addItemAction} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Item name</Label>
            <CatalogNameField
              searchCatalogAction={searchCatalogAction}
              addFromCatalogAction={addFromCatalogAction}
              defaultValue={searchParams.name ?? ""}
              placeholder="e.g. Arc'teryx Beta AR Jacket"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">
              Manufacturer link <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="url"
              name="url"
              type="url"
              inputMode="url"
              defaultValue={searchParams.url ?? ""}
              placeholder="https://www.rei.com/product/…"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              We read brand, model, composition, price and weight straight from the page — these
              authoritative facts out-rank inference. Supported: Patagonia, Arc&apos;teryx, REI, The North
              Face, Black Diamond, Marmot. If a page can&apos;t be read, we fall back to the name you
              entered.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="text">
              Known details <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="text"
              name="text"
              defaultValue={searchParams.text ?? ""}
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
            <SubmitButton pendingText="Adding…">Add &amp; review</SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
