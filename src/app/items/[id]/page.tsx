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
        <span className="text-xs font-medium text-neutral-500 w-44 shrink-0">{label}</span>
        <span className="text-xs text-amber-700 font-medium">Unknown — verify</span>
      </div>
    );
  }
  const displayVal = typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs font-medium text-neutral-500 w-44 shrink-0">{label}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold capitalize">{displayVal}</span>
        {(e.confidence && e.confidence !== "unknown") || (e.source && e.source !== "unknown") || e.evidence ? (
          <span className="text-xs text-neutral-400">
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
  searchParams: { facetError?: string };
}) {
  const item = await getItem(params.id);
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <Link href="/" className="text-xs text-neutral-500 hover:underline">
        &larr; Closet
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
          <p className="text-sm text-neutral-500">
            Added {new Date(item.createdAt).toLocaleDateString()}
            {item.inInventory ? " · In inventory" : " · Catalog only"}
          </p>
        </div>
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
            <ConfirmButton message="Delete this item?" type="submit" variant="ghost" size="sm" className="text-red-600 hover:text-red-700">
              Delete
            </ConfirmButton>
          </form>
        </div>
      </div>

      {searchParams.facetError && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {searchParams.facetError}
        </p>
      )}

      {/* Capabilities */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Capabilities</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {satisfied.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 mb-1.5">Satisfies</p>
              <div className="flex flex-wrap gap-1.5">
                {satisfied.map(({ cap, label }) => (
                  <Badge key={cap} variant="success">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {verify.length > 0 && (
            <div>
              <p className="text-xs text-neutral-500 mb-1.5">Unknown — verify before relying on</p>
              <div className="flex flex-wrap gap-1.5">
                {verify.map(({ cap, label }) => (
                  <Badge key={cap} variant="verify">{label}</Badge>
                ))}
              </div>
            </div>
          )}
          {satisfied.length === 0 && verify.length === 0 && (
            <p className="text-xs text-neutral-500">
              No capabilities confirmed. Check facets — many may be unknown.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Identity */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Identity</CardTitle></CardHeader>
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
                  <span className="text-xs text-amber-700">None — verify</span>
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

      {/* Facet editor */}
      <Card>
        <CardContent className="pt-4">
          <FacetEditor
            itemId={item.id}
            classification={c}
            action={updateFacetsAction}
          />
        </CardContent>
      </Card>
    </div>
  );
}
