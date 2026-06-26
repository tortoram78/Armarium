"use client";

// Add-to-collection control for item detail — a dropdown listing the user's collections with
// the current membership checked, toggling via server actions. Also has an inline "New collection"
// quick-create that re-uses the createCollectionAction. Guests see nothing.

import { useState, useTransition } from "react";
import { Check, ChevronDown, Plus, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Collection } from "@/core/ports";

interface CollectionPickerProps {
  itemId: string;
  collections: Collection[];
  memberOf: Collection[];
  addAction: (formData: FormData) => Promise<{ ok: boolean }>;
  removeAction: (formData: FormData) => Promise<{ ok: boolean }>;
  createCollectionAction: (formData: FormData) => Promise<void> | void;
}

export function CollectionPicker({
  itemId,
  collections,
  memberOf,
  addAction,
  removeAction,
  createCollectionAction,
}: CollectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<Set<string>>(
    new Set(memberOf.map((c) => c.id)),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [, startTransition] = useTransition();

  function toggle(col: Collection) {
    const isMember = memberIds.has(col.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("collectionId", col.id);
      fd.set("itemId", itemId);
      const result = isMember ? await removeAction(fd) : await addAction(fd);
      if (result.ok) {
        setMemberIds((prev) => {
          const next = new Set(prev);
          if (isMember) next.delete(col.id);
          else next.add(col.id);
          return next;
        });
      }
    });
  }

  const memberCount = memberIds.size;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm",
          "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-secondary text-foreground",
        )}
        aria-expanded={open}
      >
        <FolderOpen className="h-3.5 w-3.5" aria-hidden />
        {memberCount > 0
          ? `In ${memberCount} collection${memberCount > 1 ? "s" : ""}`
          : "Add to collection"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-border bg-card py-1",
            "shadow-[0_4px_16px_0_hsl(var(--shadow-soft)/0.18)]",
          )}
        >
          {collections.length === 0 && !showCreate && (
            <p className="px-3 py-2 text-sm text-muted-foreground">No collections yet.</p>
          )}

          {collections.map((col) => {
            const isMember = memberIds.has(col.id);
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => toggle(col)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2",
                    isMember ? "border-primary bg-primary" : "border-border",
                  )}
                >
                  {isMember && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{col.name}</span>
                {col.itemCount > 0 && (
                  <span className="data-mono shrink-0 text-[0.7rem] text-muted-foreground/60">
                    {col.itemCount}
                  </span>
                )}
              </button>
            );
          })}

          <div className="mt-1 border-t border-border/60 pt-1">
            {!showCreate ? (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                New collection
              </button>
            ) : (
              <form
                action={async (fd) => {
                  if (!newName.trim()) return;
                  // createCollectionAction creates the collection AND redirects to its page,
                  // but we want to stay on the item — so we intercept with our own formData
                  // by just calling it in a transition. The revalidation updates the picker
                  // next time it opens. For now, close the picker optimistically.
                  setShowCreate(false);
                  setOpen(false);
                  await createCollectionAction(fd);
                }}
                className="flex items-center gap-1 px-2 py-1.5"
              >
                {/* Pass itemId so the created collection can optionally receive the item —
                    but createCollectionAction just creates the collection (redirect handled
                    separately). We create and then the user can add via toggle. */}
                <input type="hidden" name="itemId" value={itemId} />
                <input
                  type="text"
                  name="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Collection name"
                  autoFocus
                  className={cn(
                    "h-7 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground",
                    "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
                  )}
                />
                <button
                  type="submit"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/92 transition-colors"
                  aria-label="Create collection"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary transition-colors"
                  aria-label="Cancel"
                >
                  ×
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
