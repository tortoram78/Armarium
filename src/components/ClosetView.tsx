"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PackageOpen, Plus, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/* Framer-motion variants */
const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } },
};

export function ClosetView({ items, groups, dimension, groupingLinks }: Props) {
  const itemMap = new Map(items.map((it) => [it.id, it]));

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <motion.div
        className="flex items-end justify-between gap-4"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <div>
          <h1 className="heading-display text-3xl font-extrabold uppercase tracking-tight text-foreground">
            Closet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
            {" · "}emergent facet grouping
          </p>
        </div>

        <Link
          href="/items/new"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground",
            "shadow-sm transition-all duration-150 hover:-translate-y-px hover:opacity-90 hover:shadow active:scale-[0.97]",
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          Add item
        </Link>
      </motion.div>

      {/* ── Grouping selector pills ── */}
      <motion.div
        className="flex flex-wrap gap-1.5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.1 }}
      >
        {groupingLinks.map(({ key, label }) => (
          <Link
            key={key}
            href={`/?group=${key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150",
              key === dimension
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:bg-secondary hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </motion.div>

      {/* ── Empty state ── */}
      {items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="rounded-full bg-secondary p-4">
                <PackageOpen className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <p className="text-base font-medium text-foreground">Your closet is empty</p>
              <p className="text-sm text-muted-foreground">
                Start by adding your first piece of gear.
              </p>
              <Link
                href="/items/new"
                className="mt-2 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:opacity-90"
              >
                Add first item
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        /* ── Item groups ── */
        <motion.div
          className="space-y-8"
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
                {/* Group heading */}
                <div className="mb-3 flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {grp.label}
                  </h2>
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {grpItems.length}
                  </span>
                </div>

                {/* Item cards grid */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {grpItems.map((it) => (
                    <motion.div key={it.id} variants={itemVariants}>
                      <Link href={`/items/${it.id}`} className="block h-full">
                        <Card
                          className={cn(
                            "h-full cursor-pointer",
                            "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover",
                            it.needsVerify && "border-l-2 border-l-accent",
                          )}
                        >
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base leading-snug">
                              {it.name}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="flex flex-wrap gap-1">
                              {it.needsVerify && (
                                <Badge variant="verify">verify</Badge>
                              )}
                              {it.badges.map((b) => (
                                <Badge key={b} variant="subtle">
                                  {b.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
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
