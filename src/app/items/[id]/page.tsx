import { notFound, redirect } from "next/navigation";
import { getItem, resolveItem } from "@/server/app-service";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/core/capabilities";
import { setInventoryAction, deleteItemAction, updateFacetsAction } from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { getUserIdOrGuest } from "@/lib/auth";

export const dynamic = "force-dynamic";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type EvidenceAny =
  | { value: string | number | boolean | null; confidence?: string; source?: string; evidence?: string }
  | null
  | undefined;

function renderEvidence(e: EvidenceAny, label: string) {
  if (!e || e.value === null) {
    return (
      <div className="flex items-start gap-3">
        <span className="data-mono w-44 shrink-0 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="data-mono text-[0.6875rem] uppercase tracking-wide text-blaze">Unknown — verify</span>
      </div>
    );
  }
  const displayVal = typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  return (
    <div className="flex items-start gap-3">
      <span className="data-mono w-44 shrink-0 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-0.5">
        <span className="data-mono text-xs font-medium capitalize text-foreground">{displayVal}</span>
        {(e.confidence && e.confidence !== "unknown") || (e.source && e.source !== "unknown") || e.evidence ? (
          <span className="data-mono text-[0.625rem] text-muted-foreground/80">
            {e.confidence && e.confidence !== "unknown" ? `${e.confidence} confidence` : ""}
            {e.source && e.source !== "unknown" ? ` · ${e.source}` : ""}
            {e.evidence ? ` · ${e.evidence}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { facetError?: string; edit?: string };
}) {
  // READ gate — never redirects. A guest views a sample item from the seeded closet; the write affordances
  // (inventory toggle, delete, facet editor) are hidden for a guest since their actions are write-gated.
  const { userId, isGuest } = await getUserIdOrGuest();
  const item = await getItem(params.id, userId);
  if (!item) notFound();
  // If still a draft, send to review
  if (item.draft) redirect(`/items/${params.id}/review`);

  const resolved = resolveItem(item);
  const c = item.classification;

  const capResults = CAPABILITY_KEYS.map((cap) => ({
    cap,
    label: CAPABILITY_LABELS[cap],
    result: evaluateCapability(resolved, cap),
  }));
  const satisfied = capResults.filter((r) => r.result === "satisfies");
  const verify = capResults.filter((r) => r.result === "blocked_unknown");

  const satisfiedCount = satisfied.length;
  const verifyCount = verify.length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="hud-readout inline-flex items-center gap-1.5 text-[0.625rem] tracking-[0.16em] transition-colors hover:text-blaze"
      >
        <span aria-hidden>&larr;</span> Closet&nbsp;/&nbsp;Index
      </Link>

      {/* Header — raised dossier plate with ghosted stencil + HUD readout */}
      <div className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6">
        <span className="hud-corner-tr" aria-hidden />
        <span className="hud-corner-bl" aria-hidden />
        {/* ghosted stencil item code behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-1 -top-5 text-[6rem] sm:text-[7rem]"
          aria-hidden
        >
          {item.id.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "ITM"}
        </span>
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
                Item&nbsp;·&nbsp;Facet Dossier
              </span>
            </div>
            <h1 className="heading-display text-stamped text-3xl tracking-legend text-foreground sm:text-4xl">{item.name}</h1>
            <p className="hud-readout mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] tracking-[0.15em]">
              <span>ADD&nbsp;<span className="text-foreground/85">{new Date(item.createdAt).toLocaleDateString()}</span></span>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span className={item.inInventory ? "text-foreground/85" : "text-muted-foreground"}>
                {item.inInventory ? "IN INVENTORY" : "CATALOG ONLY"}
              </span>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span>CAP&nbsp;<span className="text-foreground/85">{String(satisfiedCount).padStart(2, "0")}</span></span>
              {verifyCount > 0 && (
                <span className="flex items-center gap-1 text-blaze">
                  <span className="hud-pip" aria-hidden />{String(verifyCount).padStart(2, "0")}&nbsp;VERIFY
                </span>
              )}
            </p>
          </div>
          {/* Write affordances — hidden for a guest (their actions are write-gated behind requireUserId). */}
          {!isGuest && (
            <div className="flex shrink-0 gap-2">
              <form action={setInventoryAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="inInventory" value={item.inInventory ? "false" : "true"} />
                <Button type="submit" variant="outline" size="sm">
                  {item.inInventory ? "Remove from inventory" : "Add to inventory"}
                </Button>
              </form>
              <form action={deleteItemAction}>
                <input type="hidden" name="id" value={item.id} />
                <ConfirmButton message="Delete this item?" type="submit" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                  Delete
                </ConfirmButton>
              </form>
            </div>
          )}
        </div>
      </div>

      {searchParams.facetError && (
        <p className="surface-well border-l-2 border-destructive px-3 py-2 text-xs text-destructive">
          {searchParams.facetError}
        </p>
      )}

      {/* Capabilities — the hero data block, a raised bezel plate */}
      <Card variant="bezel">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·A</span>
            Capabilities
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {satisfied.length > 0 && (
            <div>
              <p className="data-mono mb-1.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground">Satisfies</p>
              <div className="flex flex-wrap gap-1.5">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {verify.length > 0 && (
            <div>
              <p className="data-mono mb-1.5 text-[0.625rem] uppercase tracking-wide text-blaze">Unknown — verify before relying on</p>
              <div className="flex flex-wrap gap-1.5">
                {verify.map(({ cap, label }) => (
                  <Badge key={cap} variant="verify">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {satisfied.length === 0 && verify.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No capabilities confirmed. Check facets — many may be unknown.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Identity */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·B</span>
            Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {renderEvidence(c.identity.brand, "Brand")}
          {renderEvidence(c.identity.model, "Model")}
          {c.identity.price_cents.value !== null && renderEvidence(
            { ...c.identity.price_cents, value: `$${(c.identity.price_cents.value / 100).toFixed(2)}` },
            "Price",
          )}
          {renderEvidence(c.identity.weight_grams, "Weight (g)")}
        </CardContent>
      </Card>

      {/* Universal soft facets */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·C</span>
            Universal facets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {renderEvidence(c.universal.waterproofness, "Waterproofness")}
          {renderEvidence(c.universal.wind_resistance, "Wind resistance")}
          {renderEvidence(c.universal.breathability, "Breathability")}
          {renderEvidence(c.universal.moisture_management, "Moisture management")}
          {renderEvidence(c.universal.dry_speed, "Dry speed")}
          {renderEvidence(c.universal.warmth_when_wet, "Warmth when wet")}
          {renderEvidence(c.universal.warmth, "Warmth")}
          {renderEvidence(c.universal.packability, "Packability")}
          {renderEvidence(c.universal.technical_vs_lifestyle, "Technical vs lifestyle")}
          {renderEvidence(c.universal.upf, "UPF")}
        </CardContent>
      </Card>

      {/* Multi-label facets */}
      <Card variant="well">
        <CardHeader>
          <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
            <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·D</span>
            Multi-label facets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["Layering role", c.multilabel.layering_role],
              ["Function / purpose", c.multilabel.function_purpose],
              ["Body zone", c.multilabel.body_zone_covered],
              ["Activity fit", c.multilabel.activity_fit],
              ["Conditions fit", c.multilabel.conditions_fit],
            ] as [string, readonly string[]][]
          ).map(([label, vals]) => (
            <div key={label}>
              <p className="data-mono mb-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="flex flex-wrap gap-1">
                {vals.length === 0 ? (
                  <span className="data-mono text-[0.6875rem] uppercase tracking-wide text-blaze">None — verify</span>
                ) : (
                  vals.map((v) => (
                    <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                  ))
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Domain groups */}
      {c.applicable_groups.length > 0 && (
        <Card variant="well">
          <CardHeader>
            <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
              <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·E</span>
              Domain groups
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {c.applicable_groups.map((gk) => {
              const grp = c.groups[gk as keyof typeof c.groups];
              if (!grp) return null;
              return (
                <div key={gk}>
                  <p className="label-structural mb-2 text-[0.625rem] text-muted-foreground">{gk.replace(/_/g, " ")}</p>
                  <div className="space-y-1.5">
                    {Object.entries(grp).map(([fk, fv]) =>
                      renderEvidence(fv as EvidenceAny, titleize(fk)),
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Materials */}
      {c.materials.length > 0 && (
        <Card variant="well">
          <CardHeader>
            <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
              <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·F</span>
              Materials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.materials.map((m, i) => (
              <div key={i} className="border-b border-seam/40 pb-2 text-xs text-foreground last:border-0 last:pb-0">
                <span className="font-medium capitalize">{m.role}</span>
                {m.name ? ` — ${m.name}` : ""}
                {m.fiber_components.length > 0 && (
                  <span className="data-mono text-muted-foreground">
                    {" "}({m.fiber_components.map((fc) => `${fc.fiber}${fc.pct != null ? ` ${fc.pct}%` : ""}`).join(", ")})
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Treatments */}
      {c.treatments.length > 0 && (
        <Card variant="well">
          <CardHeader>
            <CardTitle className="label-structural text-stamped flex items-center gap-2 text-xs text-foreground">
              <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">SEC·G</span>
              Treatments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {c.treatments.map((t, i) => (
              <div key={i} className="text-xs text-foreground">
                <span className="font-medium">{t.kind.replace(/_/g, " ")}</span>
                {t.condition ? ` (${t.condition.replace(/_/g, " ")})` : ""}
                <span className="text-muted-foreground">{" — "}{t.evidence}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Facet editor — interactive action plate (raised bezel). Hidden for a guest (correction is a write).
          A guest sees a read-only invitation to log in to correct facets instead. */}
      {!isGuest ? (
        <Card variant="bezel">
          <CardContent className="pt-4">
            <FacetEditor
              itemId={item.id}
              classification={c}
              action={updateFacetsAction}
              defaultOpen={searchParams.edit === "1"}
            />
          </CardContent>
        </Card>
      ) : (
        <Card variant="well">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="data-mono text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              Correcting facets requires an account.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/items/${item.id}`)}`}
              className="label-structural surface-bezel text-stamped px-4 py-2 text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))] transition-[filter] duration-150 ease-crisp hover:brightness-110"
            >
              Log in to edit
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
