import { redirect } from "next/navigation";
import { getItem, resolveItem, classifierMode } from "@/server/app-service";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/core/capabilities";
import { confirmItemAction, discardDraftAction, updateFacetsAction } from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <div className="flex items-start gap-2">
        <span className="text-xs font-medium text-neutral-500 w-40 shrink-0">{label}</span>
        <span className="text-xs text-amber-700 font-medium">Unknown — verify</span>
      </div>
    );
  }
  const displayVal = typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs font-medium text-neutral-500 w-40 shrink-0">{label}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold capitalize">{displayVal}</span>
        <span className="text-xs text-neutral-400">
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
  const item = await getItem(params.id);
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
      <div>
        <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
          <span>Review before saving</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
        {mode === "offline" && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Offline classifier — prototype corpus only. Results may be imprecise. Set{" "}
            <code>ANTHROPIC_API_KEY</code> for live classification.
          </p>
        )}
        {searchParams.facetError && (
          <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
          <CardHeader><CardTitle className="text-sm">Source text</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-600 whitespace-pre-wrap">{item.rawText}</p>
          </CardContent>
        </Card>
      )}

      {/* Identity */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {renderEvidence(c.identity.brand, "Brand")}
          {renderEvidence(c.identity.model, "Model")}
          {renderEvidence(c.identity.price_cents, "Price (cents)")}
          {renderEvidence(c.identity.weight_grams, "Weight (g)")}
        </CardContent>
      </Card>

      {/* Universal facets */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Universal facets</CardTitle></CardHeader>
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
        <CardHeader><CardTitle className="text-sm">Multi-label facets</CardTitle></CardHeader>
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
              <p className="text-xs font-medium text-neutral-500 mb-1">{label}</p>
              <div className="flex flex-wrap gap-1">
                {vals.length === 0 ? (
                  <span className="text-xs text-amber-700">None</span>
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
          <CardHeader><CardTitle className="text-sm">Domain groups</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {c.applicable_groups.map((gk) => {
              const grp = c.groups[gk as keyof typeof c.groups];
              if (!grp) return null;
              return (
                <div key={gk}>
                  <p className="text-xs font-semibold text-neutral-600 mb-2 uppercase tracking-wide">{gk}</p>
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
          <CardHeader><CardTitle className="text-sm">Materials</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {c.materials.map((m, i) => (
              <div key={i} className="text-xs border-b border-neutral-100 pb-2 last:border-0 last:pb-0">
                <span className="font-medium capitalize">{m.role}</span>
                {m.name ? ` — ${m.name}` : ""}
                {m.fiber_components.length > 0 && (
                  <span className="text-neutral-500">
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
          <CardHeader><CardTitle className="text-sm">Treatments</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {c.treatments.map((t, i) => (
              <div key={i} className="text-xs">
                <span className="font-medium">{t.kind.replace(/_/g, " ")}</span>
                {t.condition ? ` (${t.condition.replace(/_/g, " ")})` : ""}
                {" — "}{t.evidence}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Capability preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Capability preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {satisfied.length > 0 && (
            <div className="mb-2">
              <p className="text-xs text-neutral-500 mb-1">Satisfies</p>
              <div className="flex flex-wrap gap-1">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {verify.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 mb-1">Unknown — verify before relying on</p>
              <div className="flex flex-wrap gap-1">
                {verify.map(({ cap, label }) => (
                  <Badge key={cap} variant="verify">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {satisfied.length === 0 && verify.length === 0 && (
            <p className="text-xs text-neutral-500">No capabilities satisfied with current facets.</p>
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
