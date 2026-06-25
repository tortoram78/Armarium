"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ItemSummary {
  id: string;
  name: string;
  badges: string[];
  needsVerify?: boolean;
  /** Signed photo URL (ADR-0018), or null/undefined → the clean text card. */
  imageUrl?: string | null;
  /** Inventory status for quiet card marker (show only when ≠ 'owned'). */
  ownershipStatus?: string;
  /** Number of units; show ×N when > 1. */
  quantity?: number;
  /** Physical condition when recorded. */
  condition?: string | null;
  /** True when the item is record-only (no behavioral facets classified yet). */
  isRecordOnly?: boolean;
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
  /** Active search query (empty = no filter). */
  searchQ?: string;
  /** Whether the current session is a guest (hides quick-add). */
  isGuest?: boolean;
  /** Server action for the quick-add form. */
  recordOwnershipAction?: (formData: FormData) => Promise<void> | void;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Map a status string to a quiet, editorial marker label. */
function statusLabel(s: string): string | null {
  if (s === "wishlist") return "wishlist";
  if (s === "loaned") return "loaned";
  if (s === "retired") return "retired";
  if (s === "sold") return "sold";
  return null; // 'owned' → no marker
}

/** A single editorial gear card. Image-led when a photo exists (ADR-0018); a clean text card otherwise. */
function ItemCard({ item }: { item: ItemSummary }) {
  const hasImage = Boolean(item.imageUrl);
  const statusMark = item.ownershipStatus ? statusLabel(item.ownershipStatus) : null;
  const showQty = (item.quantity ?? 1) > 1;
  const showCondition = Boolean(item.condition);

  return (
    <Link
      href={`/items/${item.id}`}
      className="panel panel-hover group relative flex h-full flex-col overflow-hidden"
    >
      {hasImage && (
        <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl!}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-crisp group-hover:scale-[1.03]"
          />
          {item.needsVerify && !item.isRecordOnly && (
            <Badge variant="verify" className="absolute right-2 top-2 bg-card/90 backdrop-blur-sm">
              needs review
            </Badge>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="subhead text-[0.975rem] leading-snug text-foreground transition-colors group-hover:text-primary">
            {item.name}
          </h3>
          {item.needsVerify && !hasImage && !item.isRecordOnly && (
            <Badge variant="verify" className="shrink-0">
              needs review
            </Badge>
          )}
        </div>

        {/* Quiet inventory markers — status (when not 'owned'), quantity, condition */}
        {(statusMark || showQty || showCondition) && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {statusMark && (
              <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground/70">
                {statusMark}
              </span>
            )}
            {showQty && (
              <span className="data-mono text-[0.75rem] text-muted-foreground/70">
                ×{item.quantity}
              </span>
            )}
            {showCondition && (
              <span className="text-[0.7rem] text-muted-foreground/70">
                {item.condition!.replace(/_/g, " ")}
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {item.isRecordOnly ? (
            <span className="text-xs italic text-muted-foreground/60">
              details pending
            </span>
          ) : item.badges.length === 0 ? (
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
      </div>
    </Link>
  );
}

export function ClosetView({
  items,
  groups,
  activeGroup,
  groupingLinks,
  searchQ = "",
  isGuest = false,
  recordOwnershipAction,
}: Props) {
  const reduceMotion = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const verifyCount = items.filter((it) => it.needsVerify && !it.isRecordOnly).length;
  const isAll = activeGroup === "all";
  const hasSearch = searchQ.length > 0;

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
            {items.length === 0 && !hasSearch ? (
              "Nothing here yet — add a piece of gear to begin building your closet."
            ) : hasSearch ? (
              <>
                <span className="data-mono text-foreground">{items.length}</span>{" "}
                {items.length === 1 ? "piece" : "pieces"} matching{" "}
                <span className="text-foreground">&ldquo;{searchQ}&rdquo;</span>.
              </>
            ) : (
              <>
                <span className="data-mono text-foreground">{items.length}</span>{" "}
                {items.length === 1 ? "piece" : "pieces"} of gear.
                {verifyCount > 0 && (
                  <> {verifyCount} {verifyCount === 1 ? "needs" : "need"} a quick review.</>
                )}
              </>
            )}
          </p>
        </div>

        {/* Secondary CTA — full add flow with specs + link */}
        <Link
          href="/items/new"
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5",
            "text-sm font-medium text-foreground",
            "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
            "transition-colors duration-200 ease-crisp hover:bg-secondary hover:text-foreground active:translate-y-px",
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Add with details
        </Link>
      </motion.header>

      {/* ── Quick-add form (primary capture) — hidden for guests ── */}
      {!isGuest && recordOwnershipAction && (
        <motion.div
          {...(reduceMotion ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: EASE, delay: 0.05 } })}
          className="panel bg-muted/30 p-5 sm:p-6"
        >
          <p className="eyebrow mb-3">Quick add</p>
          <p className="mb-4 text-[0.9rem] text-muted-foreground">
            Own something? Just type its name — Armarium records it instantly. Add specs and a manufacturer
            link later.
          </p>
          <form action={recordOwnershipAction} className="flex gap-3">
            <input
              type="text"
              name="name"
              placeholder="Add anything you own — just type a name"
              autoComplete="off"
              className={cn(
                "flex h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground",
                "placeholder:text-muted-foreground/70",
                "transition-[border-color,box-shadow] duration-200 ease-crisp",
                "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
              )}
            />
            <button
              type="submit"
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2.5",
                "text-sm font-medium text-primary-foreground",
                "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
                "transition-colors duration-200 ease-crisp hover:bg-primary/92 active:translate-y-px",
              )}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
              Add
            </button>
          </form>
          <p className="mt-3 text-[0.8rem] text-muted-foreground/70">
            For manufacturer specs or a product link,{" "}
            <Link href="/items/new" className="underline underline-offset-2 hover:text-foreground transition-colors">
              use the full add flow
            </Link>
            .
          </p>
        </motion.div>
      )}

      {items.length === 0 && !hasSearch ? (
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
          {/* ── Search + grouping controls ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-border pb-5">
            {/* Search form — GET, sets ?q= */}
            <form method="GET" action="/" className="flex items-center gap-2 flex-1 min-w-[180px] max-w-xs">
              {/* Preserve active group in search form */}
              {activeGroup !== "all" && (
                <input type="hidden" name="group" value={activeGroup} />
              )}
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="search"
                  name="q"
                  defaultValue={searchQ}
                  placeholder="Search gear…"
                  className={cn(
                    "flex h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 py-2 text-sm text-foreground",
                    "placeholder:text-muted-foreground/60",
                    "transition-[border-color,box-shadow] duration-200 ease-crisp",
                    "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
                  )}
                />
              </div>
              {hasSearch && (
                <Link
                  href={activeGroup !== "all" ? `/?group=${activeGroup}` : "/"}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Clear search"
                >
                  Clear
                </Link>
              )}
            </form>

            {/* Grouping toggle: "All" + emergent facet dimensions */}
            <span className="eyebrow mr-1 hidden sm:inline">Group by</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {groupingLinks.map(({ key, label }) => {
                const active = key === activeGroup;
                // Preserve search query in grouping links
                const href = key === "all"
                  ? (searchQ ? `/?q=${encodeURIComponent(searchQ)}` : "/")
                  : `/?group=${key}${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ""}`;
                return (
                  <Link
                    key={key}
                    href={href}
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

          {/* ── Empty search results ── */}
          {hasSearch && items.length === 0 && (
            <motion.div
              {...rise}
              transition={{ duration: 0.3, ease: EASE }}
              className="panel flex flex-col items-center justify-center px-6 py-16 text-center"
            >
              <p className="display-md text-foreground">No gear matches &ldquo;{searchQ}&rdquo;</p>
              <p className="mt-2 text-[0.9rem] text-muted-foreground">
                Try a different name, brand, or model.
              </p>
              <Link
                href={activeGroup !== "all" ? `/?group=${activeGroup}` : "/"}
                className="mt-5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Clear search
              </Link>
            </motion.div>
          )}

          {items.length > 0 && (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
