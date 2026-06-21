import { addItemAction } from "@/app/actions";
import { getClassifier } from "@/server/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default function NewItemPage({ searchParams }: { searchParams: { error?: string; name?: string } }) {
  const mode = getClassifier().mode;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Masthead — field-manual section header */}
      <div className="border-b border-border pb-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
          <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
            Intake&nbsp;/&nbsp;Classify
          </span>
        </div>
        <h1 className="heading-display text-3xl tracking-legend text-foreground">Add an item</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a product name and the analysis pipeline classifies it onto the facets.
        </p>
        <p className="data-mono mt-2 flex items-center gap-2 text-[0.625rem] uppercase tracking-wide">
          <span className={mode === "offline" ? "text-blaze" : "text-foreground"}>
            {mode === "offline" ? "Offline mode" : "Live LLM"}
          </span>
          <span className="text-border" aria-hidden>|</span>
          <span className="text-muted-foreground">
            {mode === "offline"
              ? "no API key — only the prototype corpus is recognized; set ANTHROPIC_API_KEY to classify any item"
              : "live classification is on"}
          </span>
        </p>
      </div>

      <form action={addItemAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Item name</Label>
          <Input id="name" name="name" defaultValue={searchParams.name ?? ""} placeholder="e.g. Arc'teryx Beta AR Jacket" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="text">Known details (optional)</Label>
          <Textarea id="text" name="text" placeholder="Composition, weight, membrane/DWR, fill, etc. — anything you know." />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="inInventory" defaultChecked className="h-4 w-4 rounded-none accent-blaze" />
          Add to my inventory (uncheck for catalog only)
        </label>
        {searchParams.error ? (
          <p className="rounded-sm border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {searchParams.error}
          </p>
        ) : null}
        <Button type="submit">Classify &amp; save</Button>
      </form>
    </div>
  );
}
