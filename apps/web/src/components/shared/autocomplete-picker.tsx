"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Phase 17 v2 — generic autocomplete picker shared by VendorPicker
// (spec §2.4) and ProductPicker (spec §2.5).
//
// Behavior:
//   - Debounced search via searchFn(query) — async, returns list of
//     matches in the renderer's preferred shape.
//   - Keyboard navigation (↑/↓/Enter/Esc).
//   - Click outside / Esc to close.
//   - When canCreate is true AND query is non-empty AND nothing in the
//     dropdown is an exact match, a "+ Create '{query}' as new …" row
//     appears at the bottom. Clicking it calls onCreate(query), which
//     resolves to a newly-created entity that becomes the selection.
//
// The component is "controlled" — it owns the open/focus state but the
// selected entity lives in the parent form (React Hook Form etc.) so
// validation and submission Just Work.

export interface AutocompleteItem {
  id: string;
  label: string;
  /** Optional second line shown in muted text under the label. */
  subtitle?: string;
}

interface AutocompletePickerProps<T> {
  /** Currently selected entity, or null when nothing is selected. */
  value: AutocompleteItem | null;
  /** Fired when the user picks an item OR clears the selection. */
  onChange: (next: AutocompleteItem | null) => void;
  /** Fetch matches for a query. Empty query is allowed — search will
   *  pass it through (backend typically returns the first N results). */
  searchFn: (query: string) => Promise<T[]>;
  /** Map a raw API item to the AutocompleteItem shape we render. */
  toItem: (t: T) => AutocompleteItem;
  /** When provided, enables the "+ Create new" affordance at the bottom
   *  of the dropdown. The callback should persist the new entity and
   *  return the same raw shape `searchFn` returns. */
  onCreate?: (name: string) => Promise<T>;
  /** Label used in the create-row text ("Save 'X' as a new vendor"). */
  createNoun?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  /** Minimum characters before a search fires. 0 = always search (lets
   *  the user browse without typing). Default 0. */
  minQueryLength?: number;
  /** Debounce window for keystrokes. */
  debounceMs?: number;
  className?: string;
  /** Optional helper for the empty state. */
  emptyMessage?: string;
}

export default function AutocompletePicker<T>({
  value,
  onChange,
  searchFn,
  toItem,
  onCreate,
  createNoun = "item",
  placeholder = "Search…",
  disabled,
  invalid,
  id,
  name,
  minQueryLength = 0,
  debounceMs = 250,
  className,
  emptyMessage = "No results.",
}: AutocompletePickerProps<T>) {
  // Rendering state.
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [creating, setCreating] = useState(false);

  // Refs for close-on-outside-click.
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce the query into a separate state that drives the fetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(t);
  }, [query, debounceMs]);

  // Run the search when the debounced query changes — only while open
  // so we don't burn cycles on a closed picker.
  useEffect(() => {
    if (!open) return;
    if (debouncedQuery.length < minQueryLength) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchFn(debouncedQuery)
      .then((rows) => {
        if (cancelled) return;
        setResults(rows.map(toItem));
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Intentionally exclude searchFn / toItem from deps — they're
    // usually inline-defined and would re-trigger on every parent
    // render. The query is the effective input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, open, minQueryLength]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Compute whether the create-affordance should render.
  const trimmed = query.trim();
  const exactMatch = results.some(
    (r) => r.label.toLowerCase() === trimmed.toLowerCase(),
  );
  const canShowCreate =
    onCreate !== undefined && trimmed.length > 0 && !exactMatch && !loading;

  // Keyboard handler on the input.
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setFocusedIndex((i) =>
        Math.min(i + 1, results.length - 1 + (canShowCreate ? 1 : 0)),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIndex >= 0 && focusedIndex < results.length) {
        const item = results[focusedIndex]!;
        commitSelect(item);
      } else if (
        canShowCreate &&
        focusedIndex === results.length // create row position
      ) {
        void handleCreate();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const commitSelect = useCallback(
    (item: AutocompleteItem) => {
      onChange(item);
      setQuery("");
      setOpen(false);
      setFocusedIndex(-1);
    },
    [onChange],
  );

  const handleCreate = async () => {
    if (!onCreate || !trimmed) return;
    setCreating(true);
    try {
      const created = await onCreate(trimmed);
      const item = toItem(created);
      commitSelect(item);
    } catch {
      // Leave the picker open; parent likely surfaces an error elsewhere.
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={cn("relative", className)} ref={rootRef}>
      {value ? (
        // Selected state — chip-style with clear button. Click the chip
        // body to swap back into search mode.
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm",
            invalid && "border-red-500",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (disabled) return;
              setOpen(true);
              setQuery(value.label);
            }}
            className="flex-1 truncate text-left"
            disabled={disabled}
          >
            <span className="font-medium">{value.label}</span>
            {value.subtitle && (
              <span className="ml-2 text-xs text-muted-foreground">
                {value.subtitle}
              </span>
            )}
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQuery("");
              }}
              className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        // Search state.
        <div
          className={cn(
            "relative",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            id={id}
            name={name}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setFocusedIndex(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            className={cn(
              "w-full rounded-md border bg-background py-1.5 pl-3 pr-9 text-sm outline-none focus:border-primary",
              invalid && "border-red-500 focus:border-red-600",
            )}
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={disabled}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
            aria-label="Toggle dropdown"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Dropdown */}
      {open && !disabled && !value && (
        <div
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card shadow-lg"
          role="listbox"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && !canShowCreate && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          )}
          {results.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setFocusedIndex(idx)}
              onClick={() => commitSelect(item)}
              role="option"
              aria-selected={focusedIndex === idx}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                focusedIndex === idx
                  ? "bg-muted"
                  : "hover:bg-muted/60",
              )}
            >
              <span className="truncate">
                <span className="font-medium">{item.label}</span>
                {item.subtitle && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                )}
              </span>
              {focusedIndex === idx && (
                <Check className="h-3.5 w-3.5 text-primary" />
              )}
            </button>
          ))}
          {canShowCreate && (
            <button
              type="button"
              onMouseEnter={() => setFocusedIndex(results.length)}
              onClick={() => void handleCreate()}
              role="option"
              aria-selected={focusedIndex === results.length}
              className={cn(
                "flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm",
                focusedIndex === results.length
                  ? "bg-muted"
                  : "hover:bg-muted/60",
              )}
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 text-primary" />
              )}
              <span>
                Save <span className="font-medium">&ldquo;{trimmed}&rdquo;</span>{" "}
                as new {createNoun}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
