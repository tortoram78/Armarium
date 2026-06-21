import { redirect } from "next/navigation";
import { getItem, resolveItem, classifierMode } from "@/server/app-service";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/core/capabilities";
import { confirmItemAction, discardDraftAction, updateFacetsAction } from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUserId } from "@/lib/auth";

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
        <span className="data-mono w-40 shrink-0 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="data-mono text-[0.6875rem] uppercase tracking-wide text-blaze">Unknown — verify</span>
      </div>
    );
  }
  const displayVal = typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  return (
    <div className="flex items-start gap-3">
      <span className="data-mono w-40 shrink-0 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-0.5">
        <span className="data-mono text-xs font-medium capitalize text-foreground">{displayVal}</span>
        <span className="data-mono text-[0.625rem] text-muted-foreground/80">
          {e.confidence && e.confidence !== "unknown" ? `${e.confidence} confidence` : ""}
          {e.source && e.source !== "unknown" ? ` · ${e.source}` : ""}
          {e.evidence ? ` · ${e.evidence}` : ""}
        </span>
      </div>
    </div>
  );
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { facetError?: string; edit?: string };
}) {
  const userId = await requireUserId();
  const item = await getItem(params.id, userId);
  if (!item || !item.draft) {
    redirect(item ? `/items/${params.id}` : "/");
  }

  const resolved = resolveItem(item);
  const c = item.classification;
  const mode = classifierMode();

  // Evaluate all capabilities for this item
  const capResults = CAPABILITY_KEYS.map((cap) => ({
    cap,
    label: CAPABILITY_LABELS[cap],
    result: evaluateCapability(resolved, cap),
  }));
  const satisfied = capResults.filter((r) => r.result === "satisfies");
  const verify = capResults.filter((r) => r.result === "blocked_unknown");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
          <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-blaze">
            Review&nbsp;/&nbsp;Before Saving
          </span>
        </div>
        <h1 className="heading-display text-3xl tracking-legend text-foreground">{item.name}</h1>
        {mode === "offline" && (
          <p className="mt-2 rounded-sm border-l-2 border-blaze bg-blaze/10 px-3 py-2 text-xs text-foreground">
            Offline classifier — prototype corpus only. Results may be imprecise. Set{" "}
            <code className="data-mono text-blaze">ANTHROPIC_API_KEY</code> for live classification.
          </p>
        )}
        {searchParams.facetError && (
          <p className="mt-2 rounded-sm border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {searchParams.facetError}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <form action={confirmItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit">Confirm &amp; add to closet</Button>
        </form>
        <form action={discardDraftAction}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" variant="outline">Discard</Button>
        </form>
      </div>

      {/* Raw text if any */}
      {item.rawText && (
        <Card>
          <CardHeader><CardTitle className="label-structural text-xs text-foreground">Source text</CardTitle></CardHeader>
          <CardContent>
            <p className="data-mono whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.rawText}</p>
          </CardContent>
        </Card>
      )}

      {/* Identity */}
      <Card>
        <CardHeader><CardTitle className="label-structural text-xs text-foreground">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {renderEvidence(c.identity.brand, "Brand")}
          {renderEvidence(c.identity.model, "Model")}
          {renderEvidence(c.identity.price_cents, "Price (cents)")}
          {renderEvidence(c.identity.weight_grams, "Weight (g)")}
        </CardContent>
      </Card>

      {/* Universal facets */}
      <Card>
        <CardHeader><CardTitle className="label-structural text-xs text-foreground">Universal facets</CardTitle></CardHeader>
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
      <Card>
        <CardHeader><CardTitle className="label-structural text-xs text-foreground">Multi-label facets</CardTitle></CardHeader>
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
                  <span className="data-mono text-[0.6875rem] uppercase tracking-wide text-blaze">None</span>
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
        <Card>
          <CardHeader><CardTitle className="label-structural text-xs text-foreground">Domain groups</CardTitle></CardHeader>
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
        <Card>
          <CardHeader><CardTitle className="label-structural text-xs text-foreground">Materials</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {c.materials.map((m, i) => (
              <div key={i} className="border-b border-border pb-2 text-xs text-foreground last:border-0 last:pb-0">
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
        <Card>
          <CardHeader><CardTitle className="label-structural text-xs text-foreground">Treatments</CardTitle></CardHeader>
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

      {/* Capability preview */}
      <Card>
        <CardHeader>
          <CardTitle className="label-structural text-xs text-foreground">Capability preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {satisfied.length > 0 && (
            <div className="mb-2">
              <p className="data-mono mb-1 text-[0.625rem] uppercase tracking-wide text-muted-foreground">Satisfies</p>
              <div className="flex flex-wrap gap-1">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {verify.length > 0 && (
            <div>
              <p className="data-mono mb-1 text-[0.625rem] uppercase tracking-wide text-blaze">Unknown — verify before relying on</p>
              <div className="flex flex-wrap gap-1">
                {verify.map(({ cap, label }) => (
                  <Badge key={cap} variant="verify">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {satisfied.length === 0 && verify.length === 0 && (
            <p className="text-xs text-muted-foreground">No capabilities satisfied with current facets.</p>
          )}
        </CardContent>
      </Card>

      {/* Facet editor */}
      <Card>
        <CardContent className="pt-4">
          <FacetEditor
            itemId={item.id}
            classification={c}
            action={updateFacetsAction}
            defaultOpen={searchParams.edit === "1"}
          />
        </CardContent>
      </Card>

      {/* Bottom action */}
      <div className="flex gap-3 pb-8">
        <form action={confirmItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit">Confirm &amp; add to closet</Button>
        </form>
        <form action={discardDraftAction}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" variant="outline">Discard</Button>
        </form>
      </div>
    </div>
  );
}
