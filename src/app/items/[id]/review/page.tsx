import { redirect } from "next/navigation";
import Link from "next/link";
import { getItem, resolveItem, classifierMode } from "@/server/app-service";
import { evaluateCapability, CAPABILITY_KEYS, CAPABILITY_LABELS } from "@/core/capabilities";
import { confirmItemAction, discardDraftAction, updateFacetsAction } from "@/app/actions";
import { FacetEditor } from "@/components/FacetEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A serif section heading with a hairline rule and an optional mono count — the established
 *  closet/plan masthead pattern. */
function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <h2 className="display-md text-foreground">{title}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
      {count !== undefined && (
        <span className="data-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

type EvidenceAny =
  | { value: string | number | boolean | null; confidence?: string; source?: string; evidence?: string }
  | null
  | undefined;

/** A single spec row: label · value (mono for data) · quiet provenance, or an honest "unknown". */
function SpecRow({ e, label }: { e: EvidenceAny; label: string }) {
  if (!e || e.value === null) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm italic text-accent">Unknown — verify</span>
      </div>
    );
  }
  const displayVal =
    typeof e.value === "boolean" ? (e.value ? "Yes" : "No") : String(e.value).replace(/_/g, " ");
  const provenance = [
    e.confidence && e.confidence !== "unknown" ? `${e.confidence} confidence` : "",
    e.source && e.source !== "unknown" ? e.source : "",
    e.evidence ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="data-mono text-[0.8125rem] capitalize text-foreground">{displayVal}</span>
        {provenance && (
          <span className="text-[0.6875rem] leading-snug text-muted-foreground/70">{provenance}</span>
        )}
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
    <div className="mx-auto max-w-3xl space-y-10">
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> Closet
      </Link>

      {/* ── Masthead ── */}
      <header className="space-y-5">
        <div>
          <p className="eyebrow mb-3">Review &amp; confirm</p>
          <h1 className="display-xl text-foreground">{item.name}</h1>
          <p className="mt-4 max-w-prose text-[0.975rem] leading-relaxed text-muted-foreground">
            We classified this onto the facet ontology. Check the extracted facets below, correct anything
            that&apos;s off, then add it to your closet.
          </p>
        </div>

        {mode === "offline" && (
          <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            Offline classifier — prototype corpus only, results may be imprecise. Set{" "}
            <code className="data-mono">ANTHROPIC_API_KEY</code> for live classification.
          </p>
        )}
        {searchParams.facetError && (
          <p className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3 text-sm leading-relaxed text-accent">
            {searchParams.facetError}
          </p>
        )}

        {/* Primary actions */}
        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          <form action={confirmItemAction}>
            <input type="hidden" name="id" value={item.id} />
            <SubmitButton pendingText="Saving…">Confirm &amp; add to closet</SubmitButton>
          </form>
          <form action={discardDraftAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" variant="outline">Discard</Button>
          </form>
        </div>
      </header>

      {/* ── Capability preview ── */}
      <section>
        <SectionHead title="Capabilities" count={satisfied.length} />
        {satisfied.length > 0 && (
          <div className="mb-4">
            <p className="eyebrow mb-2.5">Satisfies</p>
            <div className="flex flex-wrap gap-1.5">
              {satisfied.map(({ cap, label }) => (
                <Badge key={cap} variant="success">{label}</Badge>
              ))}
            </div>
          </div>
        )}
        {verify.length > 0 && (
          <div>
            <p className="eyebrow mb-2.5 text-accent">Unknown — verify before relying on</p>
            <div className="flex flex-wrap gap-1.5">
              {verify.map(({ cap, label }) => (
                <Badge key={cap} variant="verify">{label}</Badge>
              ))}
            </div>
          </div>
        )}
        {satisfied.length === 0 && verify.length === 0 && (
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
            No capabilities satisfied with the current facets — many may be unknown. Correct them below to
            unlock more.
          </p>
        )}
      </section>

      {/* ── Source text ── */}
      {item.rawText && (
        <section>
          <SectionHead title="Source text" />
          <div className="panel bg-muted/40 p-5">
            <p className="data-mono whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {item.rawText}
            </p>
          </div>
        </section>
      )}

      {/* ── Identity ── */}
      <section>
        <SectionHead title="Identity" />
        <div className="panel px-5 py-1">
          <SpecRow e={c.identity.brand} label="Brand" />
          <SpecRow e={c.identity.model} label="Model" />
          <SpecRow e={c.identity.price_cents} label="Price (cents)" />
          <SpecRow e={c.identity.weight_grams} label="Weight (g)" />
        </div>
      </section>

      {/* ── Universal facets ── */}
      <section>
        <SectionHead title="Universal facets" />
        <div className="panel px-5 py-1">
          <SpecRow e={c.universal.waterproofness} label="Waterproofness" />
          <SpecRow e={c.universal.wind_resistance} label="Wind resistance" />
          <SpecRow e={c.universal.breathability} label="Breathability" />
          <SpecRow e={c.universal.moisture_management} label="Moisture management" />
          <SpecRow e={c.universal.dry_speed} label="Dry speed" />
          <SpecRow e={c.universal.warmth_when_wet} label="Warmth when wet" />
          <SpecRow e={c.universal.warmth} label="Warmth" />
          <SpecRow e={c.universal.packability} label="Packability" />
          <SpecRow e={c.universal.technical_vs_lifestyle} label="Technical vs lifestyle" />
          <SpecRow e={c.universal.upf} label="UPF" />
        </div>
      </section>

      {/* ── Multi-label facets ── */}
      <section>
        <SectionHead title="Multi-label facets" />
        <div className="panel space-y-4 p-5">
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
              <p className="eyebrow mb-2">{label}</p>
              <div className="flex flex-wrap gap-1.5">
                {vals.length === 0 ? (
                  <span className="text-sm italic text-accent">None</span>
                ) : (
                  vals.map((v) => (
                    <Badge key={v} variant="subtle">{titleize(v)}</Badge>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Domain groups ── */}
      {c.applicable_groups.length > 0 && (
        <section>
          <SectionHead title="Group-specific specs" />
          <div className="space-y-6">
            {c.applicable_groups.map((gk) => {
              const grp = c.groups[gk as keyof typeof c.groups];
              if (!grp) return null;
              return (
                <div key={gk}>
                  <p className="eyebrow mb-2">{titleize(gk)}</p>
                  <div className="panel px-5 py-1">
                    {Object.entries(grp).map(([fk, fv]) => (
                      <SpecRow key={fk} e={fv as EvidenceAny} label={titleize(fk)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Materials ── */}
      {c.materials.length > 0 && (
        <section>
          <SectionHead title="Materials" count={c.materials.length} />
          <div className="panel px-5 py-1">
            {c.materials.map((m, i) => (
              <div
                key={i}
                className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0"
              >
                <span className="font-medium capitalize">{m.role}</span>
                {m.name ? <span className="text-muted-foreground"> — {m.name}</span> : ""}
                {m.fiber_components.length > 0 && (
                  <span className="data-mono text-[0.8125rem] text-muted-foreground">
                    {" "}
                    ({m.fiber_components.map((fc) => `${fc.fiber}${fc.pct != null ? ` ${fc.pct}%` : ""}`).join(", ")})
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Treatments ── */}
      {c.treatments.length > 0 && (
        <section>
          <SectionHead title="Treatments" count={c.treatments.length} />
          <div className="panel px-5 py-1">
            {c.treatments.map((t, i) => (
              <div
                key={i}
                className="border-b border-border/60 py-3 text-sm leading-relaxed text-foreground last:border-0"
              >
                <span className="font-medium capitalize">{t.kind.replace(/_/g, " ")}</span>
                {t.condition ? (
                  <span className="text-muted-foreground"> ({t.condition.replace(/_/g, " ")})</span>
                ) : (
                  ""
                )}
                <span className="text-muted-foreground"> — {t.evidence}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Facet editor ── */}
      <section>
        <SectionHead title="Correct facets" />
        <FacetEditor
          itemId={item.id}
          classification={c}
          action={updateFacetsAction}
          defaultOpen={searchParams.edit === "1"}
        />
      </section>

      {/* ── Bottom actions ── */}
      <div className="flex flex-wrap gap-3 border-t border-border pt-6 pb-4">
        <form action={confirmItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <SubmitButton pendingText="Saving…">Confirm &amp; add to closet</SubmitButton>
        </form>
        <form action={discardDraftAction}>
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" variant="outline">Discard</Button>
        </form>
      </div>
    </div>
  );
}
