// Shared recommendation/gap/verify renderer — the result surface for a planned trip.
//
// Extracted verbatim from the trips/[id] dossier so a GUEST preview (/plan/preview) renders the EXACT
// same gap-analysis / verify / picks / layering-systems / full-outcomes blocks the saved-trip view does.
// Pure presentation over a `RecommendationResult` (+ its `TripConditions`); no interactivity, so this is a
// plain Server Component (no "use client"). The page above it owns the header, breadcrumb, and the
// save/save-wall control — this component is just the body.
//
// Presented as a beautifully typeset editorial GEAR REPORT: serif section headings, generous spacing,
// readable rows. Gaps / verify states are communicated calmly with the restrained terracotta accent —
// never an alarming tactical red.

import Link from "next/link";
import { CAPABILITY_LABELS } from "@/core/capabilities";
import type { CapabilityKey } from "@/core/capabilities";
import type { RecommendationResult, Severity } from "@/core/recommend";
import type { TripConditions } from "@/core/conditions";
import { Badge } from "@/components/ui/badge";

function titleize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map severity to badge variant.
const SEV_VARIANT: Record<Severity, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

// Severity order for sorting (most severe first).
const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function conditionsSummary(c: TripConditions) {
  const parts: string[] = [];
  if (c.temp_min_c !== null && c.temp_max_c !== null) {
    parts.push(`${c.temp_min_c}–${c.temp_max_c}°C`);
  } else if (c.temp_min_c !== null) {
    parts.push(`Low ${c.temp_min_c}°C`);
  } else if (c.temp_max_c !== null) {
    parts.push(`High ${c.temp_max_c}°C`);
  }
  parts.push(titleize(c.precipitation) + " precip");
  parts.push(titleize(c.wind) + " wind");
  parts.push(titleize(c.sun) + " sun");
  parts.push(titleize(c.exertion) + " exertion");
  parts.push(titleize(c.duration));
  parts.push(titleize(c.exposure));
  if (c.activities.length > 0) parts.push(c.activities.map(titleize).join(", "));
  return parts.join(" · ");
}

/** A serif section heading with a hairline rule and an optional mono count, matching the closet's
 *  grouped-section masthead. */
function SectionHead({
  title,
  count,
  accent = false,
}: {
  title: string;
  count?: number;
  accent?: boolean;
}) {
  return (
    <div className="mb-4 flex items-baseline gap-4">
      <h2 className={accent ? "display-md text-accent" : "display-md text-foreground"}>{title}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
      {count !== undefined && (
        <span className="data-mono text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

interface Props {
  result: RecommendationResult;
  /** When true, item links render as plain text (a guest can't open item detail/edit routes that gate). */
  readonly?: boolean;
}

/**
 * Render the recommendation body: gap analysis, verify, picks, layering systems, full outcomes.
 * `readonly` (the guest preview) renders item names as inert text instead of links into the gated
 * item-detail / item-edit routes — a guest can browse but those deep links would bounce to /login.
 */
export function TripResultView({ result, readonly = false }: Props) {
  // A satisfier name: a link into item detail when interactive, plain text for a guest preview.
  function itemName(id: string, name: string, edit = false) {
    if (readonly) {
      return <span className="text-sm font-medium text-foreground">{name}</span>;
    }
    return (
      <Link
        href={edit ? `/items/${id}?edit=1` : `/items/${id}`}
        className="text-sm font-medium text-accent underline-offset-2 transition-colors hover:underline"
      >
        {name}
      </Link>
    );
  }

  // Capabilities covered by a multi-item layering SYSTEM (vs. a single item) — surfaced distinctly.
  const systemOutcomes = result.outcomes.filter(
    (o) => o.satisfiedBy.length === 0 && o.satisfiedBySystem.length > 0,
  );

  return (
    <div className="space-y-12">
      {/* ── Gap analysis — the signature feature, communicated calmly in the accent ── */}
      {result.gaps.length > 0 && (
        <section>
          <SectionHead title="Gaps" count={result.gaps.length} accent />
          <p className="mb-5 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
            Your closet is missing gear to cover these required capabilities. Address critical and high
            gaps before the trip.
          </p>
          <div className="space-y-3">
            {result.gaps
              .slice()
              .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
              .map((gap) => (
                <div
                  key={gap.capability}
                  className="panel flex items-start gap-4 border-l-2 border-l-accent p-4"
                >
                  <Badge variant={SEV_VARIANT[gap.severity]} className="mt-0.5 shrink-0">
                    {titleize(gap.severity)}
                  </Badge>
                  <div>
                    <p className="text-[0.95rem] font-medium text-foreground">
                      {CAPABILITY_LABELS[gap.capability as CapabilityKey]}
                    </p>
                    {gap.reason && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{gap.reason}</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ── Needs verification — items that might satisfy but have unknown deciding facets ── */}
      {result.uncertain.length > 0 && (
        <section>
          <SectionHead title="Needs verification" count={result.uncertain.length} accent />
          <p className="mb-2 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
            You may have gear covering these needs, but a key facet is unknown. Check your item details
            and correct the facets to get a definitive answer.
          </p>
          {!readonly && (
            <p className="mb-5 text-sm text-accent">
              Correct the unknown facet on an item below, then re-plan.
            </p>
          )}
          {readonly && <div className="mb-5" />}
          <div className="space-y-3">
            {result.uncertain
              .slice()
              .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
              .map((u) => {
                // Look up blockedBy from the full outcomes array (Gap[] lacks blockedBy).
                const outcome = result.outcomes.find((o) => o.capability === u.capability);
                const blockedBy = outcome?.blockedBy ?? [];
                return (
                  <div
                    key={u.capability}
                    className="panel flex items-start gap-4 border-l-2 border-l-accent/60 p-4"
                  >
                    <Badge variant="verify" className="mt-0.5 shrink-0">
                      Verify
                    </Badge>
                    <div>
                      <p className="text-[0.95rem] font-medium text-foreground">
                        {CAPABILITY_LABELS[u.capability as CapabilityKey]}
                      </p>
                      {u.reason && (
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{u.reason}</p>
                      )}
                      {blockedBy.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          {blockedBy.map((r) => (
                            <span key={r.id}>{itemName(r.id, r.name, true)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* ── Picks — the gear from your closet that satisfies a required capability ── */}
      {result.picks.length > 0 ? (
        <section>
          <SectionHead title="Picks" count={result.picks.length} />
          <p className="mb-5 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
            These items from your closet satisfy at least one required capability.
          </p>
          <div className="space-y-3">
            {result.picks.map((pick, idx) => (
              <div key={pick.id} className="panel flex items-start gap-4 p-4">
                <span className="data-mono mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground/70">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  {readonly ? (
                    <span className="text-[0.95rem] font-medium text-foreground">{pick.name}</span>
                  ) : (
                    <Link
                      href={`/items/${pick.id}`}
                      className="text-[0.95rem] font-medium text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                    >
                      {pick.name}
                    </Link>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pick.capabilities.map((cap) => (
                      <Badge key={cap} variant="success">
                        {CAPABILITY_LABELS[cap as CapabilityKey]}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section>
          <SectionHead title="Picks" />
          <div className="panel px-6 py-12 text-center">
            <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
              No items from your inventory satisfy any required capability for this trip.{" "}
              {!readonly && (
                <Link href="/" className="text-accent underline-offset-2 hover:underline">
                  View your closet
                </Link>
              )}
            </p>
          </div>
        </section>
      )}

      {/* ── Layering systems — capabilities NO single item covers, satisfied by items worn TOGETHER ── */}
      {systemOutcomes.length > 0 && (
        <section>
          <SectionHead title="Layering systems" count={systemOutcomes.length} />
          <p className="mb-5 max-w-prose text-[0.95rem] leading-relaxed text-muted-foreground">
            No single item covers these, but items from your closet handle them{" "}
            <span className="font-medium text-foreground">together</span> as a worn layering system.
          </p>
          <div className="space-y-3">
            {systemOutcomes.map((o) =>
              // A capability may surface more than one viable system; show each as its own stack.
              o.satisfiedBySystem.map((sys, sysIdx) => (
                <div
                  key={`${o.capability}-${sysIdx}`}
                  className="panel border-l-2 border-l-primary/50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.95rem] font-medium text-foreground">
                      {CAPABILITY_LABELS[o.capability as CapabilityKey]}
                    </p>
                    <Badge variant="success" className="shrink-0">
                      {sys.items.length}-piece system
                    </Badge>
                  </div>
                  {/* The stacked members, read as one combined system (+ joined). */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t border-border pt-3">
                    {sys.items.map((m, i) => (
                      <span key={m.id} className="flex items-center gap-2.5">
                        {i > 0 && (
                          <span className="text-sm text-muted-foreground/60" aria-hidden>
                            +
                          </span>
                        )}
                        {readonly ? (
                          <span className="text-sm font-medium text-foreground">{m.name}</span>
                        ) : (
                          <Link
                            href={`/items/${m.id}`}
                            className="text-sm font-medium text-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
                          >
                            {m.name}
                          </Link>
                        )}
                      </span>
                    ))}
                    <span className="ml-1 text-sm italic text-muted-foreground/80">
                      — handled together
                    </span>
                  </div>
                </div>
              )),
            )}
          </div>
        </section>
      )}

      {/* ── Full capability outcomes — the complete audit, as a clean editorial table ── */}
      <section>
        <SectionHead title="Full capability outcomes" count={result.outcomes.length} />
        <div className="panel divide-y divide-border overflow-hidden">
          {result.outcomes.map((o) => (
            <div key={o.capability} className="flex items-start gap-4 px-4 py-3.5">
              <div className="w-32 shrink-0 pt-0.5">
                {o.status === "satisfied" && <Badge variant="success">Satisfied</Badge>}
                {o.status === "uncertain" && <Badge variant="verify">Verify</Badge>}
                {o.status === "gap" && (
                  <Badge variant={SEV_VARIANT[o.severity]}>{titleize(o.severity)} gap</Badge>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {CAPABILITY_LABELS[o.capability as CapabilityKey]}
                </p>
                {o.reason && (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{o.reason}</p>
                )}
                {o.satisfiedBy.length > 0 && (
                  <p className="mt-1.5 text-sm text-primary">
                    {o.satisfiedBy.map((r) => r.name).join(", ")}
                  </p>
                )}
                {/* System satisfier (only when no single item covers it): show the worn set, + joined. */}
                {o.satisfiedBy.length === 0 &&
                  o.satisfiedBySystem.map((sys, i) => (
                    <p key={i} className="mt-1.5 text-sm text-primary">
                      System: {sys.items.map((m) => m.name).join(" + ")}
                    </p>
                  ))}
                {o.blockedBy.length > 0 && (
                  <p className="mt-1.5 text-sm text-accent">
                    Possible — verify:{" "}
                    {o.blockedBy.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && ", "}
                        {readonly ? (
                          r.name
                        ) : (
                          <Link
                            href={`/items/${r.id}?edit=1`}
                            className="underline-offset-2 hover:underline"
                          >
                            {r.name}
                          </Link>
                        )}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
