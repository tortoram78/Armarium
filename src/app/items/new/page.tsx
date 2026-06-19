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
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Add an item</h1>
      <p className="text-sm text-neutral-500">
        Enter a product name and the analysis pipeline classifies it onto the facets.{" "}
        {mode === "offline"
          ? "Running OFFLINE (no API key) — only the prototype corpus is recognized. Set ANTHROPIC_API_KEY to classify any item."
          : "Live LLM classification is on."}
      </p>
      <form action={addItemAction} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Item name</Label>
          <Input id="name" name="name" defaultValue={searchParams.name ?? ""} placeholder="e.g. Arc'teryx Beta AR Jacket" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="text">Known details (optional)</Label>
          <Textarea id="text" name="text" placeholder="Composition, weight, membrane/DWR, fill, etc. — anything you know." />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" name="inInventory" defaultChecked className="h-4 w-4" /> Add to my inventory (uncheck for catalog only)
        </label>
        {searchParams.error ? <p className="text-sm text-red-600">{searchParams.error}</p> : null}
        <Button type="submit">Classify &amp; save</Button>
      </form>
    </div>
  );
}
