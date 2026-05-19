"use client";

import { useRef, useState } from "react";
import { Settings2, RotateCcw } from "lucide-react";
import { useOutsideClick } from "@/hooks/use-outside-click";

interface ColumnDef {
  key: string;
  label: string;
}

interface ColumnsMenuProps {
  /** All toggleable columns in display order. Non-toggleable columns
   *  (checkbox / asset # / actions) are intentionally excluded — they're
   *  structural, not display preferences. */
  columns: ColumnDef[];
  /** Map of column key → currently-visible. */
  visible: Record<string, boolean>;
  /** Toggle a single column. */
  onToggle: (key: string) => void;
  /** Reset all columns to their defaults. */
  onReset: () => void;
}

export default function ColumnsMenu({
  columns,
  visible,
  onToggle,
  onReset,
}: ColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false), open);

  const hiddenCount = columns.filter((c) => !visible[c.key]).length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        data-tour="columns-menu"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>Columns</span>
        {hiddenCount > 0 && (
          <span className="rounded-sm bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            {hiddenCount} hidden
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-md border bg-card shadow-lg">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            Show columns
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {columns.map((col) => (
              <li key={col.key}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={!!visible[col.key]}
                    onChange={() => onToggle(col.key)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span>{col.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
