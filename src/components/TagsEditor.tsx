"use client";

// Tags editor — lets an authenticated user set free-form tags on an item.
// Reads `userTags` from the item inventory; submits to `setItemTagsAction`.
// Guests see the existing tags (read-only) but the editor itself is hidden.

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface TagsEditorProps {
  itemId: string;
  tags: string[];
  isGuest: boolean;
  action: (formData: FormData) => void | Promise<void>;
}

export function TagsEditor({ itemId, tags, isGuest, action }: TagsEditorProps) {
  const [open, setOpen] = useState(false);
  // Draft value in the text input (comma/space separated)
  const [draft, setDraft] = useState(tags.join(", "));

  return (
    <div className="space-y-3">
      {/* Existing tag chips — always shown */}
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className={cn(
                "inline-flex items-center rounded border border-border bg-muted/50 px-2 py-0.5",
                "text-[0.75rem] font-medium text-foreground",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      ) : (
        !isGuest && !open && (
          <p className="text-sm italic text-muted-foreground/60">No tags yet.</p>
        )
      )}

      {/* Editor affordance — write-gated */}
      {!isGuest && (
        <>
          {!open ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(tags.join(", "));
                setOpen(true);
              }}
            >
              {tags.length > 0 ? "Edit tags" : "Add tags"}
            </Button>
          ) : (
            <form
              action={action}
              className="space-y-2"
            >
              <input type="hidden" name="id" value={itemId} />
              <div className="flex gap-2">
                <input
                  type="text"
                  name="tags"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="ultralight, borrowed, climbing"
                  autoFocus
                  className={cn(
                    "flex h-9 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground",
                    "placeholder:text-muted-foreground/60",
                    "transition-[border-color,box-shadow] duration-200 ease-crisp",
                    "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
                  )}
                />
                <Button type="submit" size="sm">Save</Button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[0.75rem] text-muted-foreground/60">
                Separate tags with commas or spaces. Tags are personal labels — not facets.
              </p>
            </form>
          )}
        </>
      )}
    </div>
  );
}
