"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ManualEntryDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the trimmed value when the user submits. */
  onSubmit: (value: string) => void;
}

/**
 * Manual barcode entry — modal text input for cases where:
 *   - camera access denied / unavailable
 *   - barcode physically unreadable (glare, damage)
 *   - desktop user without a hardware scanner (Tier 5 will add wedge
 *     detection; until then this is the universal fallback)
 *
 * Submits the trimmed input through the same `handleScan` pipeline as the
 * camera flow — same 3-tier resolution (location URL / asset barcode / EAN
 * lookup) applies. The input field auto-focuses on open so hardware
 * keyboard-wedge scanners that emulate keyboard input land here too.
 */
export default function ManualEntryDialog({
  open,
  onClose,
  onSubmit,
}: ManualEntryDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input every time the dialog opens. Wrapped in a tiny
  // timeout because Safari ignores focus() calls that fire in the same
  // tick as visibility transitions.
  useEffect(() => {
    if (!open) {
      // Reset state on close so the next open is clean.
      setValue("");
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Esc closes; Enter submits via form handler.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = value.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-entry-title"
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 w-full max-w-sm rounded-lg border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <h2 id="manual-entry-title" className="text-base font-semibold">
              Enter barcode manually
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-5 py-4">
          <label
            htmlFor="manual-entry-input"
            className="mb-1 block text-sm font-medium"
          >
            Barcode value
          </label>
          <input
            id="manual-entry-input"
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type or paste the barcode value…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Accepts asset barcodes (e.g. WDS-IT-2024-00001), 13-digit EANs,
            or pasted location URLs.
          </p>

          <footer className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!trimmed}
              className={cn(
                "rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground",
                "hover:bg-primary/90 disabled:opacity-50",
              )}
            >
              Look up
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
