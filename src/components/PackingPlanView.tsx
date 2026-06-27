// The packing CHECKLIST surface (ADR-0027) — renders a `PackingPlan` as a real, gear-first list a person
// packs from. Replaces the capability-audit table (TripResultView): sections by purpose, each line marked
// In closet / Verify / Bring, with quantities and the owned gear that covers it. Pure presentation (a
// Server Component); "mark packed" interactivity is a later pass. Gaps are framed calmly ("Bring"), not as
// a critique of the user's closet.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { NEED_CATEGORIES } from "@/core/packing";
import type { PackingPlan, PackingLine, PackItemRef, Severity } from "@/core/packing";

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-4">
      <h3 className="display-md text-foreground">{title}</h3>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="data-mono text-xs tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

/** Critical/high gaps earn a quiet accent edge; medium/low stay calm. */
const URGENT: Record<Severity, boolean> = { critical: true, high: true, medium: false, low: false };

function StatusMark({ line }: { line: PackingLine }) {
  if (line.status === "owned")
    return <Badge variant="success" className="shrink-0">In closet</Badge>;
  if (line.status === "verify")
    return <Badge variant="verify" className="shrink-0">Verify</Badge>;
  return (
    <Badge variant={URGENT[line.severity] ? "high" : "subtle"} className="shrink-0">
      Bring
    </Badge>
  );
}

function ItemNames({ refs, readonly, prefix }: { refs: PackItemRef[]; readonly: boolean; prefix?: string }) {
  if (refs.length === 0) return null;
  return (
    <p className="mt-1.5 text-sm text-primary">
      {prefix}
      {refs.map((r, i) => (
        <span key={r.id}>
          {i > 0 && " + "}
          {readonly ? (
            <span className="font-medium">{r.name}</span>
          ) : (
            <Link href={`/items/${r.id}`} className="font-medium underline-offset-2 hover:underline">
              {r.name}
            </Link>
          )}
        </span>
      ))}
    </p>
  );
}

function LineRow({ line, readonly }: { line: PackingLine; readonly: boolean }) {
  const accent = line.status === "gap" && URGENT[line.severity];
  return (
    <div
      className={
        "flex items-start gap-4 py-3 first:pt-0 last:pb-0 " +
        (accent ? "border-l-2 border-l-accent pl-3" : "")
      }
    >
      <div className="w-24 shrink-0 pt-0.5">
        <StatusMark line={line} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[0.95rem] font-medium text-foreground">{line.label}</span>
          {line.quantity && (
            <span className="data-mono text-xs tabular-nums text-muted-foreground">
              ×{line.quantity.amount} {line.quantity.unit}
            </span>
          )}
          {line.consumable && (
            <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground/60">consumable</span>
          )}
        </div>
        {line.rationale && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{line.rationale}</p>
        )}
        <ItemNames refs={line.ownedBy} readonly={readonly} />
        <ItemNames refs={line.systemBy} readonly={readonly} prefix="Worn together: " />
        {line.ownedBy.length === 0 && line.systemBy.length === 0 && (
          <ItemNames refs={line.verifyBy} readonly={readonly} prefix="Maybe — verify: " />
        )}
      </div>
    </div>
  );
}

const CAT_ORDER = new Map(NEED_CATEGORIES.map((c, i) => [c, i] as const));

export function PackingPlanView({ plan, readonly = false }: { plan: PackingPlan; readonly?: boolean }) {
  const { summary } = plan;
  const sections = [...plan.sections].sort(
    (a, b) => (CAT_ORDER.get(a.category) ?? 0) - (CAT_ORDER.get(b.category) ?? 0),
  );

  return (
    <div className="space-y-10">
      {/* Summary strip */}
      <section className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
        <span className="text-sm text-muted-foreground">
          <span className="data-mono text-foreground">{summary.total}</span> on your list
        </span>
        <span className="text-sm text-primary">
          <span className="data-mono">{summary.owned}</span> in your closet
        </span>
        {summary.verify > 0 && (
          <span className="text-sm text-accent">
            <span className="data-mono">{summary.verify}</span> to verify
          </span>
        )}
        <span className="text-sm text-muted-foreground">
          <span className="data-mono text-foreground">{summary.gap}</span> to bring / get
        </span>
        {summary.packCapacityL !== null && (
          <span className="text-sm text-muted-foreground">
            pack <span className="data-mono text-foreground">{summary.packCapacityL}L</span>
          </span>
        )}
      </section>

      {sections.map((section) => (
        <section key={section.category}>
          <SectionHead title={section.label} count={section.lines.length} />
          <div className="panel divide-y divide-border/60 px-5 py-1">
            {section.lines.map((line) => (
              <LineRow key={line.key} line={line} readonly={readonly} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
