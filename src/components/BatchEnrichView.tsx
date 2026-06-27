"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────

interface SeedItem {
  id: string;
  name: string;
}

type RowStatus =
  | "pending"
  | "enriching"
  | "classified"   // enriched + gear domain
  | "possession"   // enriched + non-gear / stayed unknown
  | "rate_limited" // backed off; will retry
  | "error";

interface RowState {
  id: string;
  name: string;
  status: RowStatus;
  badges: string[];
  retryCount: number;
  retryAt?: number; // timestamp to retry after
}

interface Props {
  items: SeedItem[];
  /** The server action that enriches one item by id. */
  enrichAction: (formData: FormData) => Promise<
    | { ok: true; id: string; classified: boolean; badges: string[] }
    | { ok: false; reason: string }
  >;
}

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────

/** Max items enriching concurrently (respects rate limits). */
const CONCURRENCY = 3;
/** Back-off delay (ms) after a rate-limit response. */
const RATE_LIMIT_BACKOFF_MS = 4000;
/** Max retries for a rate-limited row before giving up. */
const MAX_RETRIES = 5;

// ── Component ──────────────────────────────────────────────────────────────────────────────────────

export function BatchEnrichView({ items, enrichAction }: Props) {
  const [rows, setRows] = useState<RowState[]>(() =>
    items.map((i) => ({ id: i.id, name: i.name, status: "pending", badges: [], retryCount: 0 })),
  );
  const inFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const enrichOne = useCallback(
    async (row: RowState) => {
      if (!mountedRef.current) return;
      if (inFlightRef.current.has(row.id)) return;
      inFlightRef.current.add(row.id);

      // Mark as enriching
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: "enriching" } : r)),
      );

      const fd = new FormData();
      fd.set("id", row.id);

      const result = await enrichAction(fd);

      if (!mountedRef.current) {
        inFlightRef.current.delete(row.id);
        return;
      }

      if (result.ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, status: result.classified ? "classified" : "possession", badges: result.badges }
              : r,
          ),
        );
      } else if (result.reason === "rate_limited" && row.retryCount < MAX_RETRIES) {
        // Back off and retry
        const retryAt = Date.now() + RATE_LIMIT_BACKOFF_MS;
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id
              ? { ...r, status: "rate_limited", retryCount: r.retryCount + 1, retryAt }
              : r,
          ),
        );
      } else {
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: "error" } : r)),
        );
      }

      inFlightRef.current.delete(row.id);
    },
    [enrichAction],
  );

  // Drive the queue: pick pending/ready-to-retry rows up to CONCURRENCY, fire them.
  useEffect(() => {
    const now = Date.now();
    const pending = rows.filter(
      (r) =>
        (r.status === "pending" ||
          (r.status === "rate_limited" && r.retryAt !== undefined && now >= r.retryAt)) &&
        !inFlightRef.current.has(r.id),
    );
    const slots = CONCURRENCY - inFlightRef.current.size;
    if (slots <= 0 || pending.length === 0) return;

    for (const row of pending.slice(0, slots)) {
      enrichOne(row);
    }
  });

  // Retry loop: re-render when a rate-limited row is ready to retry.
  useEffect(() => {
    const rateLimited = rows.filter((r) => r.status === "rate_limited" && r.retryAt !== undefined);
    if (rateLimited.length === 0) return;
    const nearest = Math.min(...rateLimited.map((r) => r.retryAt!));
    const delay = Math.max(0, nearest - Date.now());
    const t = setTimeout(() => {
      // Force a re-render so the queue effect fires
      setRows((prev) => [...prev]);
    }, delay);
    return () => clearTimeout(t);
  }, [rows]);

  const total = rows.length;
  const done = rows.filter((r) => r.status === "classified" || r.status === "possession" || r.status === "error").length;
  const isDone = done === total;

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="flex items-baseline gap-4">
        <p className="text-sm text-muted-foreground">
          <span className="data-mono text-foreground">{done}</span>
          {" / "}
          <span className="data-mono text-foreground">{total}</span>
          {" items processed"}
        </p>
        {/* Simple progress bar */}
        <div className="h-1.5 flex-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Row list */}
      <div className="panel divide-y divide-border/60 px-5">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex min-h-[3.25rem] items-start gap-4 py-3"
          >
            {/* Status indicator */}
            <div className="mt-0.5 shrink-0">
              <StatusDot status={row.status} />
            </div>

            {/* Name + badges */}
            <div className="min-w-0 flex-1">
              <Link
                href={`/items/${row.id}`}
                className="text-sm font-medium text-foreground transition-colors hover:text-primary"
              >
                {row.name}
              </Link>
              {row.badges.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {row.badges.map((b) => (
                    <Badge key={b} variant="subtle" className="text-[0.625rem]">
                      {b.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Status text */}
            <div className="shrink-0 text-right">
              <StatusLabel status={row.status} />
            </div>
          </div>
        ))}
      </div>

      {/* CTA when done */}
      {isDone && (
        <div className="flex items-center gap-4 pt-2">
          <Link
            href="/"
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5",
              "text-sm font-medium text-primary-foreground",
              "shadow-[0_1px_2px_0_hsl(var(--shadow-soft))]",
              "transition-colors duration-200 ease-crisp hover:bg-primary/92",
            )}
          >
            View closet
          </Link>
          <Link
            href="/items/batch"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Add another list
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: RowStatus }) {
  const base = "mt-1.5 h-2 w-2 rounded-full";
  if (status === "pending")
    return <span className={cn(base, "bg-border")} />;
  if (status === "enriching")
    return (
      <span
        className={cn(base, "bg-primary animate-pulse")}
        aria-label="Filling in specs"
      />
    );
  if (status === "classified")
    return <span className={cn(base, "bg-primary/70")} />;
  if (status === "possession")
    return <span className={cn(base, "bg-muted-foreground/40")} />;
  if (status === "rate_limited")
    return <span className={cn(base, "bg-muted-foreground/40 animate-pulse")} />;
  // error — item is saved; soften the dot to not alarm
  return <span className={cn(base, "bg-muted-foreground/30")} />;
}

function StatusLabel({ status }: { status: RowStatus }) {
  if (status === "pending")
    return <span className="text-xs text-muted-foreground/60">queued</span>;
  if (status === "enriching")
    return <span className="text-xs text-muted-foreground">filling in&hellip;</span>;
  if (status === "classified")
    return <span className="text-xs text-foreground">specs added</span>;
  if (status === "possession")
    return <span className="text-xs text-muted-foreground/70">saved</span>;
  if (status === "rate_limited")
    return <span className="text-xs text-muted-foreground/70">retrying&hellip;</span>;
  // error — item is saved; specs just couldn't be auto-filled
  return <span className="text-xs text-muted-foreground/60">saved without specs</span>;
}
