"use client";

/**
 * TourTargetPicker — searchable dropdown over registered data-tour values
 * with a raw CSS selector fallback. Used in the tour step form dialog so
 * admins can pick a target element without remembering exact selectors.
 */

import { useState, useRef, useEffect, useId } from "react";
import { TOUR_TARGET_REGISTRY } from "@/lib/tour-registry";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TourTargetPickerProps {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  hasError?: boolean;
}

/**
 * Build the resolved CSS selector for a known registry value.
 * Raw selectors (not in the registry) are returned as-is.
 */
function buildSelector(raw: string): string {
  const inRegistry = TOUR_TARGET_REGISTRY.some((e) => e.value === raw);
  if (inRegistry) return `[data-tour="${raw}"]`;
  return raw;
}

export default function TourTargetPicker({
  value,
  onChange,
  id,
  hasError = false,
}: TourTargetPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"dropdown" | "raw">(
    // Start in raw mode if the current value is not a registry entry
    TOUR_TARGET_REGISTRY.some((e) => e.value === value) || value === ""
      ? "dropdown"
      : "raw",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const filtered = TOUR_TARGET_REGISTRY.filter(
    (e) =>
      e.value.includes(search.toLowerCase()) ||
      (e.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
  );

  const resolvedSelector = value ? buildSelector(value) : "";

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (entryValue: string) => {
    onChange(entryValue);
    setSearch("");
    setOpen(false);
  };

  const handleVerify = () => {
    if (!resolvedSelector) {
      toast.warning("No selector to verify.");
      return;
    }
    try {
      const el = document.querySelector(resolvedSelector);
      if (el) {
        toast.success(`Element found: ${el.tagName.toLowerCase()}`);
      } else {
        toast.error(`No element matched: ${resolvedSelector}`);
      }
    } catch {
      toast.error(`Invalid selector: ${resolvedSelector}`);
    }
  };

  return (
    <div ref={containerRef} className="space-y-1.5">
      {/* Mode toggle */}
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={() => setMode("dropdown")}
          className={cn(
            "rounded px-2 py-0.5 font-medium",
            mode === "dropdown"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          Registry picker
        </button>
        <button
          type="button"
          onClick={() => setMode("raw")}
          className={cn(
            "rounded px-2 py-0.5 font-medium",
            mode === "raw"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          Raw CSS selector
        </button>
      </div>

      {mode === "dropdown" ? (
        <div className="relative">
          {/* Trigger / search input */}
          <input
            id={id ?? inputId}
            type="text"
            value={open ? search : value}
            placeholder="Search data-tour values..."
            autoComplete="off"
            onFocus={() => {
              setSearch("");
              setOpen(true);
            }}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50",
              hasError && "border-destructive focus:ring-destructive/50",
            )}
          />
          {/* Dropdown list */}
          {open && (
            <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
              ) : (
                filtered.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => handleSelect(e.value)}
                    className={cn(
                      "flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-accent",
                      e.value === value && "bg-accent/50 font-medium",
                    )}
                  >
                    <span className="font-mono">{e.value}</span>
                    {e.description && (
                      <span className="text-muted-foreground">{e.description}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <input
          id={id ?? inputId}
          type="text"
          value={value}
          placeholder="e.g. [data-tour='asset-list'] or .my-selector"
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50",
            hasError && "border-destructive focus:ring-destructive/50",
          )}
        />
      )}

      {/* Preview chip + verify */}
      {resolvedSelector && (
        <div className="flex items-center gap-2">
          <span className="truncate rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {resolvedSelector}
          </span>
          <button
            type="button"
            onClick={handleVerify}
            className="shrink-0 rounded border px-2 py-0.5 text-xs hover:bg-accent"
          >
            Verify on this page
          </button>
        </div>
      )}
    </div>
  );
}
