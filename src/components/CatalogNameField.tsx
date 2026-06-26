"use client";

import { useRef, useState, useEffect, useCallback, useTransition } from "react";
import { cn } from "@/lib/utils";

/** Minimal suggestion shape from `searchCatalogAction`. */
interface CatalogEntry {
  key: string;
  name: string;
  brand: string | null;
  model: string | null;
}

interface CatalogNameFieldProps {
  /** Server action returned from searchCatalogAction. */
  searchCatalogAction: (formData: FormData) => Promise<CatalogEntry[]>;
  /** Server action for one-tap catalog add (addFromCatalogAction). */
  addFromCatalogAction: (formData: FormData) => Promise<void>;
  /** Default value (preserved on error redirect). */
  defaultValue?: string;
  placeholder?: string;
}

/**
 * Name input with catalog typeahead for the /items/new page.
 * As the user types, catalog matches appear. Selecting one fires
 * `addFromCatalogAction` directly (one-tap add with specs) instead of
 * the full add-item form. Selecting a non-matching name or submitting
 * the form normally still goes through `addItemAction` (plain classify flow).
 */
export function CatalogNameField({
  searchCatalogAction,
  addFromCatalogAction,
  defaultValue = "",
  placeholder = "e.g. Arc'teryx Beta AR Jacket",
}: CatalogNameFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<CatalogEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const addFormRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();

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
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      const fd = new FormData();
      fd.set("q", q);
      const results = await searchCatalogAction(fd);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveIdx(-1);
    },
    [searchCatalogAction],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 200);
  }

  function selectEntry(entry: CatalogEntry) {
    setShowSuggestions(false);
    setActiveIdx(-1);
    // Submit via the hidden catalog-add form.
    if (addFormRef.current) {
      const keyInput = addFormRef.current.querySelector<HTMLInputElement>('input[name="key"]');
      if (keyInput) keyInput.value = entry.key;
      startTransition(() => {
        addFormRef.current?.requestSubmit();
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const entry = suggestions[activeIdx];
      if (entry) selectEntry(entry);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveIdx(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden form to submit catalog-add on suggestion selection. */}
      <form ref={addFormRef} action={addFromCatalogAction} className="hidden" aria-hidden>
        <input type="hidden" name="key" value="" />
      </form>

      <input
        id="name"
        name="name"
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-activedescendant={activeIdx >= 0 ? `cnf-suggestion-${activeIdx}` : undefined}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2",
          "text-sm text-foreground placeholder:text-muted-foreground",
          "transition-[border-color,box-shadow] duration-200 ease-crisp",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        )}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-50 mt-1 w-full rounded-md border border-border bg-card",
            "shadow-[0_4px_16px_0_hsl(var(--shadow-soft)/0.16)] py-1",
          )}
        >
          <p className="px-3 py-1 text-[0.675rem] uppercase tracking-wider text-muted-foreground/60">
            Add from catalog — with specs
          </p>
          {suggestions.map((entry, i) => {
            const subtitle = [entry.brand, entry.model].filter(Boolean).join(" · ");
            return (
              <button
                key={entry.key}
                id={`cnf-suggestion-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectEntry(entry);
                }}
                className={cn(
                  "w-full px-3 py-1.5 text-left text-sm transition-colors",
                  i === activeIdx
                    ? "bg-secondary text-foreground"
                    : "text-foreground hover:bg-secondary",
                )}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span>{entry.name}</span>
                  {subtitle && (
                    <span className="shrink-0 text-[0.75rem] text-muted-foreground/70">
                      {subtitle}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
