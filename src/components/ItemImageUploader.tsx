"use client";

// Item-photo upload control (display-only — ADR-0018). A refined editorial drag-or-click picker that
// uploads the file CLIENT-DIRECT to the private `item-images` Supabase Storage bucket (keeping multi-MB
// bytes off the Next server action — ADR-0018 §C), then persists only the resulting object key via the
// `setItemImageAction` server action. The user's cookie session + Storage RLS enforce that the upload
// path begins with their own auth.uid() folder.
//
// GRACEFUL DEGRADATION: when Supabase isn't configured (the hermetic build / local dev), the browser
// client is null and this control renders NOTHING — the spec sheet simply shows no upload affordance and
// its text/hero falls back. "use client" because it does interactive file selection, drag/drop, and a
// client-side upload.

import { useRef, useState, useCallback, useId } from "react";
import { ImagePlus, UploadCloud, Loader2, Trash2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The single Supabase Storage bucket id — must match ITEM_IMAGES_BUCKET in src/server/item-images.ts. */
const BUCKET = "item-images";

/** Accepted MIME types + size cap (ADR-0018 §F). Validated client-side BEFORE any network call. */
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Build the canonical object path `<user_id>/<item_id>/<uuid>.<ext>`. This MIRRORS
 * buildItemImageObjectPath in src/server/item-images.ts (a server-only module that can't be imported into
 * a client bundle). Segment 1 is the owner uid — exactly what Storage RLS matches against auth.uid().
 */
function buildObjectPath(userId: string, itemId: string, ext: string): string {
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${userId}/${itemId}/${crypto.randomUUID()}.${clean}`;
}

interface Props {
  itemId: string;
  /** The authenticated user's id — the FIRST path segment Storage RLS keys to auth.uid(). */
  userId: string;
  /** True when the item already has a photo (shows a "Remove photo" affordance + "Replace" copy). */
  hasImage: boolean;
  /** The setItemImageAction server action (persists the uploaded object path). */
  setAction: (formData: FormData) => void | Promise<void>;
  /** The removeItemImageAction server action (nulls the image_path column). */
  removeAction: (formData: FormData) => void | Promise<void>;
}

export function ItemImageUploader({ itemId, userId, hasImage, setAction, removeAction }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();

  // If storage isn't configured, the browser client is null and the control renders NOTHING (below) — the
  // page degrades to its no-upload, text/hero layout. Resolved at call time; NEXT_PUBLIC_* are build-time-
  // inlined so this is stable per build. Computed BEFORE the early return so all hooks run unconditionally.
  const supabase = getBrowserSupabase();

  const handleFile = useCallback(
    async (file: File) => {
      if (!supabase) return;
      setError(null);
      const ext = ACCEPTED[file.type];
      if (!ext) {
        setError("Use a JPEG, PNG, or WebP image.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("That image is over 5 MB — choose a smaller file.");
        return;
      }

      setBusy(true);
      try {
        const path = buildObjectPath(userId, itemId, ext);
        // Client-direct upload. The cookie session authorizes it; Storage RLS enforces the path prefix.
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          setError("Upload failed — please try again.");
          setBusy(false);
          return;
        }
        // Hand the resulting object key to the server action, which persists it + revalidates + redirects.
        if (pathRef.current && formRef.current) {
          pathRef.current.value = path;
          formRef.current.requestSubmit();
        }
        // Leave `busy` true through the navigation that the action's redirect triggers.
      } catch {
        setError("Something went wrong uploading the photo.");
        setBusy(false);
      }
    },
    [supabase, userId, itemId],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = ""; // allow re-selecting the same file after an error
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // Storage unconfigured → render nothing (graceful degrade). All hooks above ran unconditionally.
  if (!supabase) return null;

  return (
    <div className="space-y-3">
      {/* Hidden form that carries the uploaded object path to the server action. */}
      <form ref={formRef} action={setAction} className="hidden">
        <input type="hidden" name="id" value={itemId} />
        <input ref={pathRef} type="hidden" name="path" value="" />
      </form>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={onInputChange}
        disabled={busy}
      />

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-200 ease-crisp",
          dragging
            ? "border-primary/50 bg-primary/5"
            : "border-border bg-muted/30 hover:border-foreground/25 hover:bg-muted/50",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        ) : dragging ? (
          <UploadCloud className="h-5 w-5 text-primary" aria-hidden />
        ) : (
          <ImagePlus className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
        )}
        <span className="text-sm font-medium text-foreground">
          {busy ? "Uploading…" : hasImage ? "Replace photo" : "Add a photo"}
        </span>
        <span className="text-xs text-muted-foreground">
          Drag an image here or click — JPEG, PNG, or WebP, up to 5 MB
        </span>
      </label>

      {error && (
        <p className="border-l-2 border-l-accent bg-accent/5 px-3 py-2 text-sm leading-relaxed text-accent">
          {error}
        </p>
      )}

      {hasImage && !busy && (
        <form action={removeAction}>
          <input type="hidden" name="id" value={itemId} />
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Remove photo
          </Button>
        </form>
      )}
    </div>
  );
}
