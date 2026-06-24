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

/* Four-corner registration brackets — drop into any relative panel. */
function HudBrackets() {
  return (
    <>
      <span className="hud-corner-tr" aria-hidden />
      <span className="hud-corner-bl" aria-hidden />
    </>
  );
}

export function ClosetView({ items, groups, dimension, groupingLinks }: Props) {
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const verifyCount = items.filter((it) => it.needsVerify).length;
  const groupCount = groups.filter((g) => g.itemIds.length > 0).length;

  return (
    <div className="space-y-6">
      {/* ── Masthead: raised machined plate w/ ghosted stencil + HUD rail ── */}
      <motion.div
        className="hud-brackets surface-bezel relative overflow-hidden p-5 sm:p-6"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <HudBrackets />
        {/* big ghosted stencil section number behind the title */}
        <span
          className="hud-stencil pointer-events-none absolute -right-2 -top-6 text-[7.5rem] sm:text-[9rem]"
          aria-hidden
        >
          01
        </span>
        {/* recessed screw at the panel corner (sparing hardware) */}
        <span className="hud-screw absolute right-3 top-3" aria-hidden />

        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            {/* legend kicker */}
            <div className="mb-1.5 flex items-center gap-2">
              <span className="hud-pip" aria-hidden />
              <span className="hud-readout text-[0.625rem] tracking-[0.2em]">
                Inventory&nbsp;·&nbsp;Faceted Index
              </span>
            </div>
            <h1 className="heading-display text-stamped text-4xl tracking-legend text-foreground sm:text-5xl">
              Closet
            </h1>
          </div>

          <Link
            href="/items/new"
            className={cn(
              "group surface-bezel flex shrink-0 items-center gap-2 px-4 py-2.5",
              "label-structural text-stamped text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))]",
              "transition-[transform,filter,box-shadow] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985] active:shadow-pressed",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            Add item
          </Link>
        </div>

        {/* ── HUD status rail (recessed strip, real readouts) ── */}
        <div className="surface-well relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5">
          <span className="hud-readout text-[0.625rem] tracking-[0.18em] text-foreground/80">
            N=<span className="text-foreground">{String(items.length).padStart(2, "0")}</span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            GRID&nbsp;<span className="text-foreground/85">{groupCount}×N</span>
          </span>
          <span className="h-3 w-px bg-seam/60" aria-hidden />
          <span className="hud-readout text-[0.625rem] tracking-[0.18em]">
            AXIS&nbsp;<span className="text-foreground/85">{dimension}</span>
          </span>
          {verifyCount > 0 && (
            <>
              <span className="h-3 w-px bg-seam/60" aria-hidden />
              <span className="hud-readout flex items-center gap-1.5 text-[0.625rem] tracking-[0.18em] text-blaze">
                <span className="hud-pip" aria-hidden />
                {String(verifyCount).padStart(2, "0")}&nbsp;VERIFY
              </span>
            </>
          )}
        </div>
      </motion.div>

      {/* ── Grouping selector: machined toggle keys in a recessed track ── */}
      <motion.div
        className="flex flex-wrap items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.08, ease: EASE }}
      >
        <span className="hud-readout mr-1 text-[0.625rem] tracking-[0.18em]">
          Group&nbsp;by
        </span>
        <div className="surface-well flex flex-wrap items-center gap-1 p-1">
          {groupingLinks.map(({ key, label }) => {
            const active = key === dimension;
            return (
              <Link
                key={key}
                href={`/?group=${key}`}
                className={cn(
                  "label-structural relative px-2.5 py-1 text-[0.625rem] transition-[color,box-shadow] duration-150 ease-crisp",
                  active
                    ? "surface-rail text-stamped text-foreground [background-color:hsl(var(--bezel))]"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "true" : undefined}
              >
                {active && <span className="hud-pip absolute left-1 top-1" aria-hidden />}
                {label}
              </Link>
            );
          })}
        </div>
      </motion.div>

      {/* ── Empty state ── */}
      {items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="surface-well px-6 py-16 text-center"
        >
          <p className="label-structural text-stamped text-sm text-foreground">Closet is empty</p>
          <p className="data-mono mt-2 text-xs text-muted-foreground">
            Add your first piece of gear to begin the index.
          </p>
          <Link
            href="/items/new"
            className="label-structural surface-bezel text-stamped mt-5 inline-block px-5 py-2 text-[0.6875rem] [background-color:hsl(var(--primary))] [color:hsl(var(--primary-foreground))] transition-[transform,filter] duration-150 ease-crisp hover:brightness-110 active:scale-[0.985]"
          >
            Add first item
          </Link>
        </motion.div>
      ) : (
        /* ── Indexed groups: each sits DOWN in a recessed well ── */
        <motion.div
          className="space-y-6"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {groups.map((grp, gi) => {
            const grpItems = grp.itemIds
              .map((id) => itemMap.get(id))
              .filter(Boolean) as ItemSummary[];
            if (grpItems.length === 0) return null;
            return (
              <section key={grp.key} className="surface-well p-3 sm:p-4">
                {/* Group heading — stamped legend row with a HUD index code */}
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="hud-readout text-[0.5625rem] tracking-[0.18em] text-hud/80">
                    SEC·{String(gi + 1).padStart(2, "0")}
                  </span>
                  <h2 className="label-structural text-stamped text-xs text-foreground">
                    {grp.label}
                  </h2>
                  <span className="h-px flex-1 bg-seam/40" aria-hidden />
                  <span className="data-mono text-[0.625rem] tabular-nums text-muted-foreground">
                    {String(grpItems.length).padStart(2, "0")}
                  </span>
                </div>

                {/* Item cards — raised machined plates proud of the well */}
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {grpItems.map((it, idx) => (
                    <motion.div key={it.id} variants={itemVariants}>
                      <Link
                        href={`/items/${it.id}`}
                        className={cn(
                          "surface-bezel group relative flex h-full flex-col gap-2.5 p-3.5",
                          "transition-[background-color,filter,transform] duration-150 ease-crisp hover:brightness-[1.06]",
                        )}
                      >
                        {/* verify = blaze left edge marker (cut into the plate) */}
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
                          {it.needsVerify ? (
                            <Badge variant="verify">verify</Badge>
                          ) : (
                            <span className="hud-readout shrink-0 text-[0.5625rem] leading-none text-hud/70">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                          )}
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
