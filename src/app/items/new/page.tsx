import { addItemAction } from "@/app/actions";
import { getClassifier } from "@/server/services";
import { SubmitButton } from "@/components/SubmitButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default function NewItemPage({ searchParams }: { searchParams: { error?: string; name?: string } }) {
  const mode = getClassifier().mode;
  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Masthead — raised machined plate w/ ghosted stencil + HUD status rail */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* big ghosted stencil section number behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-2 -top-6 text-[7.5rem] sm:text-[9rem]"
          aria-hidden
        >
          02
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="hud-pip" aria-hidden />
            <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
              Intake&nbsp;·&nbsp;Classify
            </span>
          </div>
          <h1 className="heading-display text-stamped text-4xl tracking-legend text-foreground sm:text-5xl">
            Add an item
          </h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Enter a product name and the analysis pipeline classifies it onto the facets.
          </p>
        </div>

        {/* ── HUD status rail (recessed strip, real readout of the classifier mode) ── */}
        <div className="surface-well relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
          <span className="hud-readout flex items-center gap-1.5 text-[0.625rem] tracking-[0.18em]">
            {mode === "offline" && <span className="hud-pip" aria-hidden />}
            MODE&nbsp;
            <span className={mode === "offline" ? "text-blaze" : "text-foreground/85"}>
              {mode === "offline" ? "OFFLINE" : "LIVE LLM"}
            </span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em] text-muted-foreground">
            {mode === "offline"
              ? "no API key — only the prototype corpus is recognized"
              : "live classification is on"}
          </span>
        </div>
      </div>

      {/* Intake form — raised action plate */}
      <Card variant="bezel">
        <CardContent className="pt-4">
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
              <p className="surface-well border-l-2 border-destructive px-3 py-2 text-sm text-destructive">
                {searchParams.error}
              </p>
            ) : null}
            <SubmitButton pendingText="Classifying…">Classify &amp; save</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
