"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ItemSummary {
  id: string;
  name: string;
  badges: string[];
  needsVerify?: boolean;
}

interface Group {
  key: string;
  label: string;
  itemIds: string[];
}

interface Props {
  items: ItemSummary[];
  groups: Group[];
  dimension: string;
  groupingLinks: { key: string; label: string }[];
}

/* Crisp eases — decisive, zero overshoot (no spring/bounce). */
const EASE = [0.22, 1, 0.36, 1] as const;

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.025, delayChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } },
};

export function ClosetView({ items, groups, dimension, groupingLinks }: Props) {
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const verifyCount = items.filter((it) => it.needsVerify).length;

  return (
    <div className="space-y-6">
      {/* ── Masthead: field-manual section header ── */}
      <motion.div
        className="border-b border-border pb-4"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <div className="flex items-end justify-between gap-4">
          <div>
            {/* legend kicker */}
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2.5 w-0.5 bg-blaze" aria-hidden />
              <span className="data-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                Inventory&nbsp;/&nbsp;Faceted Index
              </span>
            </div>
            <h1 className="heading-display text-4xl tracking-legend text-foreground">
              Closet
            </h1>
            {/* spec readout */}
            <p className="data-mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              <span>
                <span className="text-foreground">{items.length}</span> item{items.length === 1 ? "" : "s"}
              </span>
              <span className="text-border" aria-hidden>|</span>
              <span>grouped by <span className="text-foreground">{dimension}</span></span>
              {verifyCount > 0 && (
                <>
                  <span className="text-border" aria-hidden>|</span>
                  <span className="text-blaze">{verifyCount} to verify</span>
                </>
              )}
            </p>
          </div>

          <Link
            href="/items/new"
            className={cn(
              "group flex shrink-0 items-center gap-2 rounded-sm bg-primary px-4 py-2.5",
              "label-structural text-[0.6875rem] text-primary-foreground shadow-letterpress",
              "transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985] active:shadow-press-in",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            Add item
          </Link>
        </div>
      </motion.div>

      {/* ── Grouping selector: legend toggles (orange tick on active) ── */}
      <motion.div
        className="flex flex-wrap items-center gap-x-1 gap-y-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.08, ease: EASE }}
      >
        <span className="data-mono mr-2 text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
          Group&nbsp;by
        </span>
        {groupingLinks.map(({ key, label }) => {
          const active = key === dimension;
          return (
            <Link
              key={key}
              href={`/?group=${key}`}
              className={cn(
                "label-structural relative rounded-sm border px-2.5 py-1 text-[0.625rem] transition-colors duration-150 ease-crisp",
                active
                  ? "border-blaze bg-blaze/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
              aria-current={active ? "true" : undefined}
            >
              {label}
            </Link>
          );
        })}
      </motion.div>

      {/* ── Empty state ── */}
      {items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="border border-dashed border-border bg-card/40 px-6 py-16 text-center"
        >
          <p className="label-structural text-sm text-foreground">Closet is empty</p>
          <p className="data-mono mt-2 text-xs text-muted-foreground">
            Add your first piece of gear to begin the index.
          </p>
          <Link
            href="/items/new"
            className="label-structural mt-5 inline-block rounded-sm bg-primary px-5 py-2 text-[0.6875rem] text-primary-foreground shadow-letterpress transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985]"
          >
            Add first item
          </Link>
        </motion.div>
      ) : (
        /* ── Indexed groups ── */
        <motion.div
          className="space-y-7"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {groups.map((grp) => {
            const grpItems = grp.itemIds
              .map((id) => itemMap.get(id))
              .filter(Boolean) as ItemSummary[];
            if (grpItems.length === 0) return null;
            return (
              <section key={grp.key}>
                {/* Group heading — topo legend row with a hairline rule */}
                <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-1.5">
                  <h2 className="label-structural text-xs text-foreground">
                    {grp.label}
                  </h2>
                  <span className="h-px flex-1 bg-border" aria-hidden />
                  <span className="data-mono text-[0.625rem] tabular-nums text-muted-foreground">
                    {String(grpItems.length).padStart(2, "0")}
                  </span>
                </div>

                {/* Item cards — flat, hairline, machined */}
                <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                  {grpItems.map((it) => (
                    <motion.div key={it.id} variants={itemVariants}>
                      <Link
                        href={`/items/${it.id}`}
                        className={cn(
                          "group relative flex h-full flex-col gap-2.5 bg-card p-3.5",
                          "transition-colors duration-150 ease-crisp hover:bg-secondary/50",
                        )}
                      >
                        {/* verify = blaze left edge marker */}
                        {it.needsVerify && (
                          <span
                            className="absolute inset-y-0 left-0 w-0.5 bg-blaze"
                            aria-hidden
                          />
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug text-foreground">
                            {it.name}
                          </h3>
                          {it.needsVerify && <Badge variant="verify">verify</Badge>}
                        </div>
                        <div className="mt-auto flex flex-wrap gap-1">
                          {it.badges.length === 0 ? (
                            <span className="data-mono text-[0.625rem] uppercase tracking-wide text-muted-foreground/70">
                              — no facets —
                            </span>
                          ) : (
                            it.badges.map((b) => (
                              <Badge key={b} variant="subtle">
                                {b.replace(/_/g, " ")}
                              </Badge>
                            ))
                          )}
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </section>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
