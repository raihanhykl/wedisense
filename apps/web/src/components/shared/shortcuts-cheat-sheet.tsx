"use client";

import { X } from "lucide-react";

interface ShortcutEntry {
  keys: string[]; // Each item rendered as a `kbd` chip.
  description: string;
}

interface ShortcutsCheatSheetProps {
  open: boolean;
  onClose: () => void;
  shortcuts: ShortcutEntry[];
}

export default function ShortcutsCheatSheet({
  open,
  onClose,
  shortcuts,
}: ShortcutsCheatSheetProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-2">
          {shortcuts.map((s, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {s.description}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, ki) => (
                  <kbd
                    key={ki}
                    className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] text-muted-foreground">
          Shortcuts are disabled while typing in inputs or text areas.
        </p>
      </div>
    </div>
  );
}
