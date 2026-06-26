"use client";

// CollectionsView — client component for the /collections page.
// Manages the "New collection" form, inline rename, confirm-delete per row.

import { useState, useTransition } from "react";
import Link from "next/link";
import { FolderOpen, Plus, Check, Trash2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Collection } from "@/core/ports";
import { Button } from "@/components/ui/button";

interface CollectionsViewProps {
  collections: Collection[];
  createAction: (formData: FormData) => void | Promise<void>;
  renameAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}

interface CollectionRowProps {
  col: Collection;
  renameAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}

function CollectionRow({ col, renameAction, deleteAction }: CollectionRowProps) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm-delete">("view");
  const [renameDraft, setRenameDraft] = useState(col.name);
  const [, startTransition] = useTransition();

  if (mode === "rename") {
    return (
      <div className="flex items-center gap-2 border-b border-border/60 py-3 last:border-0">
        <form
          className="flex flex-1 items-center gap-2"
          action={async (fd) => {
            startTransition(() => { renameAction(fd); });
            setMode("view");
          }}
        >
          <input type="hidden" name="id" value={col.id} />
          <input
            type="text"
            name="name"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            maxLength={120}
            autoFocus
            className={cn(
              "h-8 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground",
              "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30",
            )}
          />
          <button
            type="submit"
            className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/92 transition-colors"
            aria-label="Save"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary transition-colors"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-0">
        <p className="text-sm text-foreground">
          Delete <span className="font-medium">&ldquo;{col.name}&rdquo;</span>? Items are not affected.
        </p>
        <div className="flex shrink-0 gap-2">
          <form
            action={async (fd) => {
              startTransition(() => { deleteAction(fd); });
            }}
          >
            <input type="hidden" name="id" value={col.id} />
            <button
              type="submit"
              className="rounded px-3 py-1 text-sm text-destructive hover:bg-destructive/8 transition-colors"
            >
              Delete
            </button>
          </form>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-0">
      <Link
        href={`/collections/${col.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-primary"
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
          {col.name}
        </span>
        <span className="data-mono shrink-0 text-xs tabular-nums text-muted-foreground/60">
          {col.itemCount} {col.itemCount === 1 ? "item" : "items"}
        </span>
      </Link>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => { setRenameDraft(col.name); setMode("rename"); }}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:bg-secondary hover:text-foreground transition-colors"
          aria-label={`Rename ${col.name}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMode("confirm-delete")}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/8 hover:text-destructive transition-colors"
          aria-label={`Delete ${col.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function CollectionsView({
  collections,
  createAction,
  renameAction,
  deleteAction,
}: CollectionsViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      {/* New collection form */}
      <div className="panel bg-muted/30 p-5">
        <p className="eyebrow mb-3">New collection</p>
        {!showCreate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Create a collection
          </Button>
        ) : (
          <form
            action={async (fd) => {
              startTransition(() => { createAction(fd); });
              setShowCreate(false);
              setNewName("");
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              name="name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name"
              maxLength={120}
              autoFocus
              className={cn(
                "h-10 flex-1 max-w-xs rounded-md border border-input bg-card px-3.5 py-2 text-sm text-foreground",
                "placeholder:text-muted-foreground/60",
                "transition-[border-color,box-shadow] duration-200 ease-crisp",
                "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
              )}
            />
            <Button type="submit" size="sm">
              Create
            </Button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      {/* Collections list */}
      {collections.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
          <FolderOpen className="mb-4 h-8 w-8 text-muted-foreground/40" aria-hidden />
          <h2 className="display-md text-foreground">No collections yet</h2>
          <p className="mt-2 max-w-sm text-[0.9rem] leading-relaxed text-muted-foreground">
            Create a collection to group your gear into named kits — climbing rack, layering system,
            winter pack.
          </p>
        </div>
      ) : (
        <div className="panel px-5 py-1">
          {collections.map((col) => (
            <CollectionRow
              key={col.id}
              col={col}
              renameAction={renameAction}
              deleteAction={deleteAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}
