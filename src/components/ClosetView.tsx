"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect, useOptimistic, useCallback, useTransition } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus, Search, LayoutGrid, List, X, ChevronDown, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────

export interface ItemSummary {
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
  /** True when the item is classified into the gear domain. */
  isGear?: boolean;
  /** User-curated tags (Phase 4 — clickable to filter by tag). */
  userTags?: string[];
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
  /** Active ownership-status filter (undefined = all). */
  activeStatus?: string;
  /** Active condition filter (undefined = all). */
  activeCondition?: string;
  /** Active sort (defaults to 'newest'). */
  activeSort?: "newest" | "name";
  /** Active view mode (grid | list). */
  activeView?: "grid" | "list";
  /** Active tag filter (undefined = no tag filter). */
  activeTag?: string;
  /** Opaque cursor for the next page in the All view; null = last page. */
  nextCursor?: string | null;
  /** Whether the current session is a guest (hides write affordances). */
  isGuest?: boolean;
  /** Server action for the quick-add form. */
  recordOwnershipAction?: (formData: FormData) => Promise<void> | void;
  /** Server action for inline rename. */
  renameItemAction?: (formData: FormData) => Promise<void> | void;
  /** Server action for inline inventory patch (status / qty). */
  updateInventoryAction?: (formData: FormData) => Promise<void> | void;
  /** Server action for delete. */
  deleteItemAction?: (formData: FormData) => Promise<void> | void;
  /** Server action for load-more pagination. */
  loadMoreAction?: (formData: FormData) => Promise<{
    items: ItemSummary[];
    nextCursor: string | null;
  }>;
  /** Server action for bulk operations. */
  bulkUpdateAction?: (formData: FormData) => Promise<void>;
  /** Typeahead suggestions action (owned-closet matches). */
  suggestItemsAction?: (formData: FormData) => Promise<{ id: string; name: string }[]>;
  /** Catalog autocomplete action (self-building KB — returns items with specs). */
  searchCatalogAction?: (formData: FormData) => Promise<{ key: string; name: string; brand: string | null; model: string | null }[]>;
  /** One-tap catalog add action — adds an item with inherited specs by catalog key. */
  addFromCatalogAction?: (formData: FormData) => Promise<void>;
  /** Duplicate warning: the name that triggered a dup check redirect. */
  dupName?: string;
  /** Duplicate warning: the existing item's id. */
  dupId?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

/** Map a status string to a quiet, editorial marker label. */
function statusLabel(s: string): string | null {
  if (s === "wishlist") return "wishlist";
  if (s === "loaned") return "loaned";
  if (s === "retired") return "retired";
  if (s === "sold") return "sold";
  return null; // 'owned' → no marker
}

/** Build a URL preserving all current filter params, overriding only the given key. */
function buildFilterHref(
  current: { q: string; status: string; condition: string; sort: string; view: string; group: string; tag: string },
  override: Partial<typeof current>,
): string {
  const merged = { ...current, ...override };
  const p = new URLSearchParams();
  if (merged.group && merged.group !== "all") p.set("group", merged.group);
  if (merged.q) p.set("q", merged.q);
  if (merged.status) p.set("status", merged.status);
  if (merged.condition) p.set("condition", merged.condition);
  if (merged.sort && merged.sort !== "newest") p.set("sort", merged.sort);
  if (merged.view && merged.view !== "grid") p.set("view", merged.view);
  if (merged.tag) p.set("tag", merged.tag);
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

// ── Inline quick-action menu (client) ─────────────────────────────────────────────────────────────

const OWNERSHIP_STATUS_OPTIONS = ["wishlist", "owned", "loaned", "retired", "sold"] as const;

interface ItemActionsProps {
  item: ItemSummary;
  isGuest?: boolean;
  renameAction?: (formData: FormData) => Promise<void> | void;
  updateAction?: (formData: FormData) => Promise<void> | void;
  deleteAction?: (formData: FormData) => Promise<void> | void;
}

function ItemActions({ item, isGuest, renameAction, updateAction, deleteAction }: ItemActionsProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "qty" | "status">("menu");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode("menu");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (mode === "rename" && renameRef.current) renameRef.current.focus();
  }, [mode]);

  if (isGuest || (!renameAction && !updateAction && !deleteAction)) return null;

  return (
    <div ref={menuRef} className="relative" onClick={(e) => e.preventDefault()}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
          setMode("menu");
        }}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60",
          "transition-colors hover:bg-secondary hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Item actions"
      >
        <span className="text-base leading-none select-none">⋯</span>
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-8 z-50 min-w-[160px] rounded-md border border-border bg-card",
            "shadow-[0_4px_16px_0_hsl(var(--shadow-soft)/0.18)] py-1",
          )}
        >
          {mode === "menu" && (
            <>
              {renameAction && (
                <button
                  type="button"
                  onClick={() => setMode("rename")}
                  className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  Rename
                </button>
              )}
              {updateAction && (
                <button
                  type="button"
                  onClick={() => setMode("status")}
                  className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  Change status
                </button>
              )}
              {updateAction && (
                <button
                  type="button"
                  onClick={() => setMode("qty")}
                  className="w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-secondary transition-colors"
                >
                  Set quantity
                </button>
              )}
              {deleteAction && (
                <>
                  <div className="my-1 border-t border-border/60" />
                  <form
                    action={async (fd) => {
                      if (!confirm("Delete this item? This cannot be undone.")) return;
                      startTransition(() => { deleteAction(fd); });
                      setOpen(false);
                    }}
                  >
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/8 transition-colors"
                    >
                      Delete
                    </button>
                  </form>
                </>
              )}
            </>
          )}

          {mode === "rename" && renameAction && (
            <form
              className="flex items-center gap-1 px-2 py-1.5"
              action={async (fd) => {
                startTransition(() => { renameAction(fd); });
                setOpen(false);
                setMode("menu");
              }}
            >
              <input type="hidden" name="id" value={item.id} />
              <input
                ref={renameRef}
                type="text"
                name="name"
                defaultValue={item.name}
                maxLength={120}
                className={cn(
                  "h-7 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground",
                  "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
                )}
                placeholder="New name"
              />
              <button
                type="submit"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/92 transition-colors"
                aria-label="Save name"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </form>
          )}

          {mode === "status" && updateAction && (
            <div className="py-0.5">
              <p className="px-3 py-1 text-[0.7rem] uppercase tracking-wider text-muted-foreground/60">Set status</p>
              {OWNERSHIP_STATUS_OPTIONS.map((s) => (
                <form
                  key={s}
                  action={async (fd) => {
                    startTransition(() => { updateAction(fd); });
                    setOpen(false);
                    setMode("menu");
                  }}
                >
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="ownershipStatus" value={s} />
                  <input type="hidden" name="quantity" value={String(item.quantity ?? 1)} />
                  <button
                    type="submit"
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary",
                      item.ownershipStatus === s ? "text-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    {s}
                    {item.ownershipStatus === s && <span className="ml-1.5 text-[0.65rem] text-muted-foreground/60">current</span>}
                  </button>
                </form>
              ))}
            </div>
          )}

          {mode === "qty" && updateAction && (
            <form
              className="flex items-center gap-1 px-2 py-1.5"
              action={async (fd) => {
                startTransition(() => { updateAction(fd); });
                setOpen(false);
                setMode("menu");
              }}
            >
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="ownershipStatus" value={item.ownershipStatus ?? "owned"} />
              <input
                type="number"
                name="quantity"
                min={1}
                max={999}
                defaultValue={item.quantity ?? 1}
                className={cn(
                  "h-7 w-16 rounded border border-input bg-background px-2 text-sm text-foreground",
                  "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
                )}
              />
              <button
                type="submit"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/92 transition-colors"
                aria-label="Save quantity"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Item card ──────────────────────────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  selected,
  onSelect,
  selecting,
  isGuest,
  renameAction,
  updateAction,
  deleteAction,
}: {
  item: ItemSummary;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  selecting?: boolean;
  isGuest?: boolean;
  renameAction?: (formData: FormData) => Promise<void> | void;
  updateAction?: (formData: FormData) => Promise<void> | void;
  deleteAction?: (formData: FormData) => Promise<void> | void;
  activeTag?: string;
}) {
  const hasImage = Boolean(item.imageUrl);
  const statusMark = item.ownershipStatus ? statusLabel(item.ownershipStatus) : null;
  const showQty = (item.quantity ?? 1) > 1;
  const showCondition = Boolean(item.condition);
  // Gear display tags are suppressed for non-gear items (domain gate)
  const showBadges = item.isGear !== false;

  return (
    <div className="relative group">
      {selecting && onSelect && (
        <label className="absolute left-2.5 top-2.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border-2 border-border bg-card shadow-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary">
          <input
            type="checkbox"
            className="sr-only"
            checked={selected ?? false}
            onChange={(e) => onSelect(item.id, e.target.checked)}
          />
          {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
        </label>
      )}
      <Link
        href={`/items/${item.id}`}
        className="panel panel-hover flex h-full flex-col overflow-hidden"
        tabIndex={selecting ? -1 : undefined}
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
            {item.needsVerify && !item.isRecordOnly && showBadges && (
              <Badge variant="verify" className="absolute right-2 top-2 bg-card/90 backdrop-blur-sm">
                needs review
              </Badge>
            )}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="subhead text-[0.975rem] leading-snug text-foreground transition-colors group-hover:text-primary">
              {item.name}
            </h3>
            <div className="flex shrink-0 items-center gap-1">
              {item.needsVerify && !hasImage && !item.isRecordOnly && showBadges && (
                <Badge variant="verify" className="shrink-0">
                  needs review
                </Badge>
              )}
              <div
                onClick={(e) => e.preventDefault()}
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              >
                <ItemActions
                  item={item}
                  isGuest={isGuest}
                  renameAction={renameAction}
                  updateAction={updateAction}
                  deleteAction={deleteAction}
                />
              </div>
            </div>
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
            ) : !showBadges ? (
              <span className="text-xs italic text-muted-foreground/60">
                not yet classified
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
          {/* User-curated tag chips — clickable to filter by that tag */}
          {item.userTags && item.userTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1" onClick={(e) => e.preventDefault()}>
              {item.userTags.map((t) => (
                <a
                  key={t}
                  href={`/?tag=${encodeURIComponent(t)}`}
                  className={cn(
                    "inline-flex items-center rounded border px-1.5 py-0.5 text-[0.65rem] font-medium transition-colors",
                    "border-border/60 bg-muted/50 text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {t}
                </a>
              ))}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

// ── List row ───────────────────────────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  selected,
  onSelect,
  selecting,
  isGuest,
  renameAction,
  updateAction,
  deleteAction,
}: {
  item: ItemSummary;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  selecting?: boolean;
  isGuest?: boolean;
  renameAction?: (formData: FormData) => Promise<void> | void;
  updateAction?: (formData: FormData) => Promise<void> | void;
  deleteAction?: (formData: FormData) => Promise<void> | void;
}) {
  const statusMark = item.ownershipStatus ? statusLabel(item.ownershipStatus) : null;
  const showQty = (item.quantity ?? 1) > 1;
  const showBadges = item.isGear !== false;

  return (
    <div className="group relative flex items-center gap-3 border-b border-border/60 py-2.5 last:border-0">
      {selecting && onSelect && (
        <label className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-2 border-border bg-card transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary">
          <input
            type="checkbox"
            className="sr-only"
            checked={selected ?? false}
            onChange={(e) => onSelect(item.id, e.target.checked)}
          />
          {selected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
        </label>
      )}
      <Link
        href={`/items/${item.id}`}
        className="flex min-w-0 flex-1 items-center gap-4"
        tabIndex={selecting ? -1 : undefined}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          {item.name}
        </span>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {statusMark && (
            <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground/60">{statusMark}</span>
          )}
          {showQty && (
            <span className="data-mono text-[0.75rem] text-muted-foreground/60">×{item.quantity}</span>
          )}
          {item.condition && (
            <span className="text-[0.7rem] text-muted-foreground/60">{item.condition.replace(/_/g, " ")}</span>
          )}
        </div>
        <div className="hidden shrink-0 flex-wrap items-center gap-1 lg:flex max-w-[200px]">
          {item.isRecordOnly ? (
            <span className="text-xs italic text-muted-foreground/50">details pending</span>
          ) : !showBadges ? (
            <span className="text-xs italic text-muted-foreground/50">not yet classified</span>
          ) : (
            item.badges.slice(0, 2).map((b) => (
              <Badge key={b} variant="subtle" className="text-[0.625rem]">
                {b.replace(/_/g, " ")}
              </Badge>
            ))
          )}
        </div>
        {item.needsVerify && !item.isRecordOnly && showBadges && (
          <Badge variant="verify" className="hidden shrink-0 sm:inline-flex">needs review</Badge>
        )}
      </Link>
      <div
        onClick={(e) => e.preventDefault()}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      >
        <ItemActions
          item={item}
          isGuest={isGuest}
          renameAction={renameAction}
          updateAction={updateAction}
          deleteAction={deleteAction}
        />
      </div>
    </div>
  );
}

// ── Paginated grid (client) ────────────────────────────────────────────────────────────────────────

interface PaginatedGridProps {
  initialItems: ItemSummary[];
  initialCursor: string | null;
  view: "grid" | "list";
  selecting: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  isGuest?: boolean;
  renameAction?: (formData: FormData) => Promise<void> | void;
  updateAction?: (formData: FormData) => Promise<void> | void;
  deleteAction?: (formData: FormData) => Promise<void> | void;
  loadMoreAction?: (formData: FormData) => Promise<{ items: ItemSummary[]; nextCursor: string | null }>;
  search: string;
  status: string;
  condition: string;
  sort: string;
  reduceMotion: boolean | null;
}

function PaginatedGrid({
  initialItems,
  initialCursor,
  view,
  selecting,
  selectedIds,
  onSelect,
  isGuest,
  renameAction,
  updateAction,
  deleteAction,
  loadMoreAction,
  search,
  status,
  condition,
  sort,
  reduceMotion,
}: PaginatedGridProps) {
  const [items, setItems] = useState<ItemSummary[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);

  // Sync when SSR items change (filter/search navigation)
  useEffect(() => {
    setItems(initialItems);
    setCursor(initialCursor);
  }, [initialItems, initialCursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading || !loadMoreAction) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("cursor", cursor);
      if (search) fd.set("search", search);
      if (status) fd.set("status", status);
      if (condition) fd.set("condition", condition);
      fd.set("sort", sort || "newest");
      const result = await loadMoreAction(fd);
      setItems((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, loadMoreAction, search, status, condition, sort]);

  // IntersectionObserver auto-load
  useEffect(() => {
    const el = loaderRef.current;
    if (!el || !cursor) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cursor, loadMore]);

  const gridItem = reduceMotion
    ? {}
    : {
        variants: {
          hidden: { opacity: 0, y: 12 },
          show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
        },
      };
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

  if (view === "list") {
    return (
      <div>
        <div className="panel divide-y divide-border/60 px-5">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              selected={selectedIds.has(it.id)}
              onSelect={onSelect}
              selecting={selecting}
              isGuest={isGuest}
              renameAction={renameAction}
              updateAction={updateAction}
              deleteAction={deleteAction}
            />
          ))}
        </div>
        {cursor && (
          <div ref={loaderRef} className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm text-muted-foreground",
                "transition-colors hover:bg-secondary hover:text-foreground",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <motion.div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        {...gridContainer}
      >
        {items.map((it) => (
          <motion.div key={it.id} {...gridItem}>
            <ItemCard
              item={it}
              selected={selectedIds.has(it.id)}
              onSelect={onSelect}
              selecting={selecting}
              isGuest={isGuest}
              renameAction={renameAction}
              updateAction={updateAction}
              deleteAction={deleteAction}
            />
          </motion.div>
        ))}
      </motion.div>
      {cursor && (
        <div ref={loaderRef} className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm text-muted-foreground",
              "transition-colors hover:bg-secondary hover:text-foreground",
              "disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {loading ? "Loading…" : "Load more"}
            {!loading && <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Quick-add with dual-source typeahead (client) ─────────────────────────────────────────────────

/** A single flat item for keyboard navigation — tagged by source. */
type SuggestionItem =
  | { source: "owned"; id: string; name: string }
  | { source: "catalog"; key: string; name: string; brand: string | null; model: string | null };

interface QuickAddProps {
  recordOwnershipAction: (formData: FormData) => Promise<void> | void;
  suggestItemsAction?: (formData: FormData) => Promise<{ id: string; name: string }[]>;
  searchCatalogAction?: (formData: FormData) => Promise<{ key: string; name: string; brand: string | null; model: string | null }[]>;
  addFromCatalogAction?: (formData: FormData) => Promise<void>;
}

function QuickAdd({ recordOwnershipAction, suggestItemsAction, searchCatalogAction, addFromCatalogAction }: QuickAddProps) {
  const [value, setValue] = useState("");
  // Flat list of all suggestions across both sources — owned first, then catalog (deduped by name).
  const [allSuggestions, setAllSuggestions] = useState<SuggestionItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const addFromCatalogFormRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setAllSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      const fd = new FormData();
      fd.set("q", q);

      // Fire both in parallel — owned closet + global catalog.
      const [ownedResults, catalogResults] = await Promise.all([
        suggestItemsAction ? suggestItemsAction(fd) : Promise.resolve([] as { id: string; name: string }[]),
        searchCatalogAction ? searchCatalogAction(fd) : Promise.resolve([] as { key: string; name: string; brand: string | null; model: string | null }[]),
      ]);

      // Build the owned set so catalog can dedupe by normalized name.
      const ownedNames = new Set(ownedResults.map((o) => o.name.trim().toLowerCase()));

      const owned: SuggestionItem[] = ownedResults.map((o) => ({
        source: "owned",
        id: o.id,
        name: o.name,
      }));

      const catalog: SuggestionItem[] = catalogResults
        .filter((c) => !ownedNames.has(c.name.trim().toLowerCase()))
        .map((c) => ({
          source: "catalog",
          key: c.key,
          name: c.name,
          brand: c.brand,
          model: c.model,
        }));

      const merged = [...owned, ...catalog];
      setAllSuggestions(merged);
      setShowSuggestions(merged.length > 0);
      setActiveIdx(-1);
    },
    [suggestItemsAction, searchCatalogAction],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 200);
  }

  function activateSuggestion(item: SuggestionItem) {
    setShowSuggestions(false);
    setActiveIdx(-1);
    if (item.source === "owned") {
      router.push(`/items/${item.id}`);
    } else {
      // One-tap catalog add — submit the hidden form with the catalog key.
      if (addFromCatalogFormRef.current) {
        const keyInput = addFromCatalogFormRef.current.querySelector<HTMLInputElement>('input[name="key"]');
        if (keyInput) keyInput.value = item.key;
        addFromCatalogFormRef.current.requestSubmit();
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || allSuggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, allSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const item = allSuggestions[activeIdx];
      if (item) activateSuggestion(item);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveIdx(-1);
    }
  }

  const ownedSuggestions = allSuggestions.filter((s) => s.source === "owned");
  const catalogSuggestions = allSuggestions.filter((s) => s.source === "catalog");

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden form for catalog add — submitted programmatically on selection. */}
      {addFromCatalogAction && (
        <form ref={addFromCatalogFormRef} action={addFromCatalogAction} className="hidden" aria-hidden>
          <input type="hidden" name="key" value="" />
        </form>
      )}
      <form action={recordOwnershipAction} className="flex gap-3">
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            name="name"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (allSuggestions.length > 0) setShowSuggestions(true); }}
            placeholder="Add anything you own — just type a name"
            autoComplete="off"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-activedescendant={activeIdx >= 0 ? `qa-suggestion-${activeIdx}` : undefined}
            className={cn(
              "flex h-11 w-full rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground/70",
              "transition-[border-color,box-shadow] duration-200 ease-crisp",
              "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
            )}
          />
          {/* Dual-source suggestions dropdown */}
          {showSuggestions && allSuggestions.length > 0 && (
            <div
              role="listbox"
              className={cn(
                "absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-border bg-card",
                "shadow-[0_4px_16px_0_hsl(var(--shadow-soft)/0.16)] py-1",
              )}
            >
              {/* Group 1: In your closet */}
              {ownedSuggestions.length > 0 && (
                <>
                  <p className="px-3 py-1 text-[0.675rem] uppercase tracking-wider text-muted-foreground/60">
                    In your closet
                  </p>
                  {ownedSuggestions.map((s) => {
                    const globalIdx = allSuggestions.indexOf(s);
                    return (
                      <button
                        key={s.id}
                        id={`qa-suggestion-${globalIdx}`}
                        role="option"
                        aria-selected={globalIdx === activeIdx}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          activateSuggestion(s);
                        }}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-sm transition-colors",
                          globalIdx === activeIdx
                            ? "bg-secondary text-foreground"
                            : "text-foreground hover:bg-secondary",
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </>
              )}
              {/* Group 2: Add from catalog */}
              {catalogSuggestions.length > 0 && (
                <>
                  <p className={cn(
                    "px-3 py-1 text-[0.675rem] uppercase tracking-wider text-muted-foreground/60",
                    ownedSuggestions.length > 0 && "mt-1 border-t border-border/40 pt-2",
                  )}>
                    Add from catalog — with specs
                  </p>
                  {catalogSuggestions.map((s) => {
                    const globalIdx = allSuggestions.indexOf(s);
                    const subtitle = [s.brand, s.model].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={s.key}
                        id={`qa-suggestion-${globalIdx}`}
                        role="option"
                        aria-selected={globalIdx === activeIdx}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          activateSuggestion(s);
                        }}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-sm transition-colors",
                          globalIdx === activeIdx
                            ? "bg-secondary text-foreground"
                            : "text-foreground hover:bg-secondary",
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span>{s.name}</span>
                          {subtitle && (
                            <span className="shrink-0 text-[0.75rem] text-muted-foreground/70">
                              {subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
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
    </div>
  );
}

// ── Main ClosetView ────────────────────────────────────────────────────────────────────────────────

export function ClosetView({
  items,
  groups,
  activeGroup,
  groupingLinks,
  searchQ = "",
  activeStatus = "",
  activeCondition = "",
  activeSort = "newest",
  activeView = "grid",
  activeTag = "",
  nextCursor = null,
  isGuest = false,
  recordOwnershipAction,
  renameItemAction,
  updateInventoryAction,
  deleteItemAction,
  loadMoreAction,
  bulkUpdateAction,
  suggestItemsAction,
  searchCatalogAction,
  addFromCatalogAction,
  dupName,
  dupId,
}: Props) {
  const reduceMotion = useReducedMotion();
  const searchRef = useRef<HTMLInputElement>(null);
  const itemMap = new Map(items.map((it) => [it.id, it]));
  const verifyCount = items.filter((it) => it.needsVerify && !it.isRecordOnly && it.isGear !== false).length;
  const isAll = activeGroup === "all";
  const hasSearch = searchQ.length > 0;
  const hasActiveFilter = Boolean(activeStatus) || Boolean(activeCondition) || activeSort !== "newest" || Boolean(activeTag);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [bulkOp, setBulkOp] = useState<"set_status" | "delete">("set_status");
  const [bulkStatus, setBulkStatus] = useState("owned");
  const [, startBulkTransition] = useTransition();

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function exitSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  const rise = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };

  const nonEmptyGroups = groups.filter((g) => g.itemIds.length > 0);

  // Current filter state for URL building
  const filterState = {
    q: searchQ,
    status: activeStatus,
    condition: activeCondition,
    sort: activeSort,
    view: activeView,
    group: isAll ? "all" : activeGroup,
    tag: activeTag,
  };

  const OWNERSHIP_STATUS_OPTIONS = ["wishlist", "owned", "loaned", "retired", "sold"] as const;
  const CONDITION_OPTIONS = ["new", "good", "worn", "end_of_life"] as const;

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
            {items.length === 0 && !hasSearch && !hasActiveFilter ? (
              "Nothing here yet — add a piece of gear to begin building your closet."
            ) : hasSearch || hasActiveFilter ? (
              <>
                <span className="data-mono text-foreground">{items.length}</span>{" "}
                {items.length === 1 ? "item" : "items"} found.
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

        {/* Masthead actions: add with details + export CSV */}
        <div className="flex shrink-0 items-center gap-2">
          {!isGuest && (
            <a
              href="/api/export"
              className={cn(
                "inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5",
                "text-sm font-medium text-muted-foreground",
                "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
                "transition-colors duration-200 ease-crisp hover:bg-secondary hover:text-foreground",
              )}
            >
              Export CSV
            </a>
          )}
          <Link
            href="/items/new"
            className={cn(
              "inline-flex items-center gap-2 rounded-md border border-border bg-card px-5 py-2.5",
              "text-sm font-medium text-foreground",
              "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
              "transition-colors duration-200 ease-crisp hover:bg-secondary hover:text-foreground active:translate-y-px",
            )}
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            Add with details
          </Link>
        </div>
      </motion.header>

      {/* ── Duplicate warning banner ── */}
      {dupName && dupId && !isGuest && recordOwnershipAction && (
        <div className="panel border-l-2 border-l-accent bg-accent/5 px-4 py-3">
          <p className="text-sm text-foreground">
            You may already own{" "}
            <span className="font-medium">&ldquo;{dupName}&rdquo;</span>.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <Link
              href={`/items/${dupId}`}
              className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
            >
              View it
            </Link>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <form
              action={async (fd) => {
                recordOwnershipAction(fd);
              }}
            >
              <input type="hidden" name="name" value={dupName} />
              <input type="hidden" name="force" value="1" />
              <button type="submit" className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">
                Add anyway
              </button>
            </form>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            {updateInventoryAction && (
              <form
                action={async (fd) => {
                  updateInventoryAction(fd);
                }}
              >
                <input type="hidden" name="id" value={dupId} />
                <input type="hidden" name="ownershipStatus" value="owned" />
                <input type="hidden" name="quantity" value="2" />
                <button type="submit" className="text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">
                  +1 quantity
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Quick-add panel (primary capture) — hidden for guests ── */}
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
          <QuickAdd
            recordOwnershipAction={recordOwnershipAction}
            suggestItemsAction={suggestItemsAction}
            searchCatalogAction={searchCatalogAction}
            addFromCatalogAction={addFromCatalogAction}
          />
          <p className="mt-3 text-[0.8rem] text-muted-foreground/70">
            For manufacturer specs or a product link,{" "}
            <Link href="/items/new" className="underline underline-offset-2 hover:text-foreground transition-colors">
              use the full add flow
            </Link>
            {" · "}
            <Link href="/items/batch" className="underline underline-offset-2 hover:text-foreground transition-colors">
              paste a list
            </Link>
            .
          </p>
        </motion.div>
      )}

      {items.length === 0 && !hasSearch && !hasActiveFilter ? (
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
          {/* ── Filter + search bar ── */}
          <div className="space-y-3 border-b border-border pb-5">
            {/* Row 1: search + view toggle */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
              {/* Search form — GET, sets ?q= and preserves other filters */}
              <form method="GET" action="/" className="flex items-center gap-2 flex-1 min-w-[180px] max-w-xs">
                {/* Preserve all active filters in search form */}
                {activeGroup !== "all" && <input type="hidden" name="group" value={activeGroup} />}
                {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
                {activeCondition && <input type="hidden" name="condition" value={activeCondition} />}
                {activeSort !== "newest" && <input type="hidden" name="sort" value={activeSort} />}
                {activeView !== "grid" && <input type="hidden" name="view" value={activeView} />}
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
                    href={buildFilterHref(filterState, { q: "" })}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Clear search"
                  >
                    Clear
                  </Link>
                )}
              </form>

              <div className="ml-auto flex items-center gap-1.5">
                {/* View toggle: grid / list */}
                <div className="flex items-center rounded-md border border-border bg-card">
                  <Link
                    href={buildFilterHref(filterState, { view: "grid" })}
                    aria-label="Grid view"
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-l-md border-r border-border transition-colors",
                      activeView === "grid"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Link>
                  <Link
                    href={buildFilterHref(filterState, { view: "list" })}
                    aria-label="List view"
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-r-md transition-colors",
                      activeView === "list"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <List className="h-4 w-4" />
                  </Link>
                </div>

                {/* Bulk select toggle */}
                {!isGuest && (
                  <button
                    type="button"
                    onClick={() => { setSelecting((s) => !s); setSelectedIds(new Set()); }}
                    className={cn(
                      "h-9 rounded-md border px-3 text-[0.8125rem] font-medium transition-colors",
                      selecting
                        ? "border-primary bg-primary/8 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    {selecting ? "Cancel" : "Select"}
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: filter pills + grouping */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* Status filter */}
              <div className="flex items-center gap-1.5">
                <span className="eyebrow text-[0.7rem]">Status</span>
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={buildFilterHref(filterState, { status: "" })}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors",
                      !activeStatus ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    All
                  </Link>
                  {OWNERSHIP_STATUS_OPTIONS.map((s) => (
                    <Link
                      key={s}
                      href={buildFilterHref(filterState, { status: activeStatus === s ? "" : s })}
                      className={cn(
                        "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors capitalize",
                        activeStatus === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {s}
                    </Link>
                  ))}
                </div>
              </div>

              <span className="h-4 w-px bg-border/60 hidden sm:block" aria-hidden />

              {/* Condition filter */}
              <div className="flex items-center gap-1.5">
                <span className="eyebrow text-[0.7rem]">Condition</span>
                <div className="flex flex-wrap gap-1">
                  <Link
                    href={buildFilterHref(filterState, { condition: "" })}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors",
                      !activeCondition ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    All
                  </Link>
                  {CONDITION_OPTIONS.map((c) => (
                    <Link
                      key={c}
                      href={buildFilterHref(filterState, { condition: activeCondition === c ? "" : c })}
                      className={cn(
                        "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors capitalize",
                        activeCondition === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {c.replace(/_/g, " ")}
                    </Link>
                  ))}
                </div>
              </div>

              <span className="h-4 w-px bg-border/60 hidden sm:block" aria-hidden />

              {/* Sort */}
              <div className="flex items-center gap-1.5">
                <span className="eyebrow text-[0.7rem]">Sort</span>
                <div className="flex gap-1">
                  <Link
                    href={buildFilterHref(filterState, { sort: "newest" })}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors",
                      activeSort === "newest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    Newest
                  </Link>
                  <Link
                    href={buildFilterHref(filterState, { sort: "name" })}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.75rem] font-medium transition-colors",
                      activeSort === "name" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    Name
                  </Link>
                </div>
              </div>

              {/* Active tag chip with clear affordance */}
              {activeTag && (
                <div className="flex items-center gap-1.5">
                  <span className="eyebrow text-[0.7rem]">Tag</span>
                  <Link
                    href={buildFilterHref(filterState, { tag: "" })}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/8 px-2 py-0.5",
                      "text-[0.75rem] font-medium text-primary transition-colors hover:bg-primary/14",
                    )}
                  >
                    {activeTag}
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </Link>
                </div>
              )}

              {/* Clear all filters affordance */}
              {hasActiveFilter && (
                <Link
                  href={buildFilterHref({ q: searchQ, status: "", condition: "", sort: "newest", view: activeView, group: filterState.group, tag: "" }, {})}
                  className="flex items-center gap-1 text-[0.75rem] text-accent hover:text-accent/80 transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </Link>
              )}
            </div>

            {/* Row 3: Grouping toggle */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1 hidden sm:inline text-[0.7rem]">Group by</span>
              {groupingLinks.map(({ key, label }) => {
                const active = key === activeGroup;
                const href = buildFilterHref(filterState, { group: key });
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

          {/* ── Bulk action bar ── */}
          {selecting && selectedIds.size > 0 && bulkUpdateAction && (
            <div className="panel flex flex-wrap items-center gap-3 border-l-2 border-l-primary bg-primary/5 px-4 py-3">
              <span className="data-mono text-sm text-foreground">{selectedIds.size} selected</span>
              <div className="flex items-center gap-2">
                <select
                  value={bulkOp}
                  onChange={(e) => setBulkOp(e.target.value as "set_status" | "delete")}
                  className="h-8 rounded border border-input bg-card px-2 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="set_status">Set status…</option>
                  <option value="delete">Delete</option>
                </select>
                {bulkOp === "set_status" && (
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    className="h-8 rounded border border-input bg-card px-2 text-[0.8125rem] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {OWNERSHIP_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
                <form
                  action={async (fd) => {
                    if (bulkOp === "delete") {
                      if (!confirm(`Delete ${selectedIds.size} item${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
                    }
                    startBulkTransition(() => { bulkUpdateAction(fd); });
                    exitSelecting();
                  }}
                >
                  {Array.from(selectedIds).map((id) => (
                    <input key={id} type="hidden" name="ids" value={id} />
                  ))}
                  <input type="hidden" name="op" value={bulkOp} />
                  {bulkOp === "set_status" && <input type="hidden" name="status" value={bulkStatus} />}
                  <button
                    type="submit"
                    className={cn(
                      "h-8 rounded px-3 text-[0.8125rem] font-medium transition-colors",
                      bulkOp === "delete"
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/92"
                        : "bg-primary text-primary-foreground hover:bg-primary/92",
                    )}
                  >
                    Apply
                  </button>
                </form>
              </div>
              <button
                type="button"
                onClick={exitSelecting}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* ── Empty search/filter results ── */}
          {(hasSearch || hasActiveFilter) && items.length === 0 && (
            <motion.div
              {...rise}
              transition={{ duration: 0.3, ease: EASE }}
              className="panel flex flex-col items-center justify-center px-6 py-16 text-center"
            >
              <p className="display-md text-foreground">No items match these filters</p>
              <p className="mt-2 text-[0.9rem] text-muted-foreground">
                Try clearing the search or adjusting the status / condition filter.
              </p>
              <Link
                href={isAll ? "/" : `/?group=${activeGroup}`}
                className="mt-5 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Clear all
              </Link>
            </motion.div>
          )}

          {items.length > 0 && (
            <>
              {isAll ? (
                /* ── DEFAULT: paginated flat grid / list of every item ── */
                <PaginatedGrid
                  initialItems={items}
                  initialCursor={nextCursor}
                  view={activeView}
                  selecting={selecting}
                  selectedIds={selectedIds}
                  onSelect={handleSelect}
                  isGuest={isGuest}
                  renameAction={renameItemAction}
                  updateAction={updateInventoryAction}
                  deleteAction={deleteItemAction}
                  loadMoreAction={loadMoreAction}
                  search={searchQ}
                  status={activeStatus}
                  condition={activeCondition}
                  sort={activeSort}
                  reduceMotion={reduceMotion}
                />
              ) : (
                /* ── Grouped by an emergent facet dimension ── */
                <div className="space-y-10">
                  {nonEmptyGroups.map((grp) => {
                    const grpItems = grp.itemIds
                      .map((id) => itemMap.get(id))
                      .filter(Boolean) as ItemSummary[];
                    if (grpItems.length === 0) return null;
                    return (
                      <section key={grp.key}>
                        <div className="mb-4 flex items-baseline gap-4">
                          <h2 className="display-md text-foreground">{grp.label}</h2>
                          <span className="h-px flex-1 bg-border" aria-hidden />
                          <span className="data-mono text-xs tabular-nums text-muted-foreground">
                            {grpItems.length}
                          </span>
                        </div>
                        {activeView === "list" ? (
                          <div className="panel divide-y divide-border/60 px-5">
                            {grpItems.map((it) => (
                              <ItemRow
                                key={it.id}
                                item={it}
                                selected={selectedIds.has(it.id)}
                                onSelect={handleSelect}
                                selecting={selecting}
                                isGuest={isGuest}
                                renameAction={renameItemAction}
                                updateAction={updateInventoryAction}
                                deleteAction={deleteItemAction}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {grpItems.map((it) => (
                              <ItemCard
                                key={it.id}
                                item={it}
                                selected={selectedIds.has(it.id)}
                                onSelect={handleSelect}
                                selecting={selecting}
                                isGuest={isGuest}
                                renameAction={renameItemAction}
                                updateAction={updateInventoryAction}
                                deleteAction={deleteItemAction}
                              />
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
