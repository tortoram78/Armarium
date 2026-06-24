"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
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
  /** "all" → flat grid of everything; otherwise the active grouping dimension key. */
  activeGroup: string;
  groupingLinks: { key: string; label: string }[];
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** A single editorial gear card. */
function ItemCard({ item }: { item: ItemSummary }) {
  return (
    <Link
      href={`/items/${item.id}`}
      className="panel panel-hover group relative flex h-full flex-col gap-3 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="subhead text-[0.975rem] leading-snug text-foreground transition-colors group-hover:text-primary">
          {item.name}
        </h3>
        {item.needsVerify && (
          <Badge variant="verify" className="shrink-0">
            needs review
          </Badge>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {item.badges.length === 0 ? (
          <span className="text-xs italic text-muted-foreground/70">
            no facets yet
          </span>
        ) : (
          item.badges.map((b) => (
            <Badge key={b} variant="subtle">
              {b.replace(/_/g, " ")}
            </Badge>
          ))
        )}
      </div>
    </Link>
  );
}

export function ClosetView({ items, groups, activeGroup, groupingLinks }: Props) {
  const reduceMotion = useReducedMotion();
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const verifyCount = items.filter((it) => it.needsVerify).length;
  const isAll = activeGroup === "all";

  const rise = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };

  const gridContainer = reduceMotion
    ? {}
    : {
        initial: "hidden",
        animate: "show",
        variants: {
          hidden: {},
          show: { transition: { staggerChildren: 0.04, delayChildren: 0.08 } },
        },
      };
  const gridItem = reduceMotion
    ? {}
    : {
        variants: {
          hidden: { opacity: 0, y: 12 },
          show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
        },
      };

  const nonEmptyGroups = groups.filter((g) => g.itemIds.length > 0);

  return (
    <div className="space-y-10">
      {/* ── Masthead ── */}
      <motion.header
        className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5"
        {...(reduceMotion
          ? {}
          : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: EASE } })}
      >
        <div className="max-w-2xl">
          <p className="eyebrow mb-3">Your gear</p>
          <h1 className="display-xl text-foreground">Closet</h1>
          <p className="mt-4 max-w-xl text-[0.975rem] leading-relaxed text-muted-foreground">
            {items.length === 0 ? (
              "Nothing here yet — add a piece of gear to begin building your closet."
            ) : (
              <>
                {items.length} {items.length === 1 ? "piece" : "pieces"} of gear.
                {verifyCount > 0 && (
                  <> {verifyCount} {verifyCount === 1 ? "needs" : "need"} a quick review.</>
                )}
              </>
            )}
          </p>
        </div>

        <Link
          href="/items/new"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-5 py-2.5",
            "text-sm font-medium text-primary-foreground",
            "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
            "transition-colors duration-200 ease-crisp hover:bg-primary/92 active:translate-y-px",
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Add gear
        </Link>
      </motion.header>

      {items.length === 0 ? (
        /* ── Empty state ── */
        <motion.div
          {...rise}
          transition={{ duration: 0.4, ease: EASE }}
          className="panel flex flex-col items-center justify-center px-6 py-20 text-center"
        >
          <h2 className="display-md text-foreground">An empty closet</h2>
          <p className="mt-3 max-w-sm text-[0.95rem] leading-relaxed text-muted-foreground">
            Add your first piece of gear and Armarium will classify its facets, then reason about what to
            pack for any trip.
          </p>
          <Link
            href="/items/new"
            className="mt-7 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_1px_2px_0_hsl(var(--shadow-soft))] transition-colors duration-200 ease-crisp hover:bg-primary/92"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            Add your first item
          </Link>
        </motion.div>
      ) : (
        <div className="space-y-7">
          {/* ── Grouping toggle: "All" + emergent facet dimensions ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-border pb-5">
            <span className="eyebrow mr-1">Group by</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {groupingLinks.map(({ key, label }) => {
                const active = key === activeGroup;
                return (
                  <Link
                    key={key}
                    href={key === "all" ? "/" : `/?group=${key}`}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors duration-200 ease-crisp",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                    aria-current={active ? "true" : undefined}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          {isAll ? (
            /* ── DEFAULT: flat grid of every item ── */
            <motion.div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              {...gridContainer}
            >
              {items.map((it) => (
                <motion.div key={it.id} {...gridItem}>
                  <ItemCard item={it} />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            /* ── Grouped by an emergent facet dimension ── */
            <motion.div className="space-y-10" {...gridContainer}>
              {nonEmptyGroups.map((grp) => {
                const grpItems = grp.itemIds
                  .map((id) => itemMap.get(id))
                  .filter(Boolean) as ItemSummary[];
                if (grpItems.length === 0) return null;
                return (
                  <motion.section key={grp.key} {...gridItem}>
                    <div className="mb-4 flex items-baseline gap-4">
                      <h2 className="display-md text-foreground">{grp.label}</h2>
                      <span className="h-px flex-1 bg-border" aria-hidden />
                      <span className="data-mono text-xs tabular-nums text-muted-foreground">
                        {grpItems.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {grpItems.map((it) => (
                        <ItemCard key={it.id} item={it} />
                      ))}
                    </div>
                  </motion.section>
                );
              })}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
