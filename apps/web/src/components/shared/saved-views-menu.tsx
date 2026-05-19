"use client";

import { useRef, useState } from "react";
import { ChevronDown, Save, Star, Pencil, Trash2, Check } from "lucide-react";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { useSavedViews } from "@/hooks/use-saved-views";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/error";
import type { SavedView } from "@/types/admin";

interface SavedViewsMenuProps {
  /** Resource key — e.g. "assets" — passed to the hook and on save. */
  resource: string;
  /** Currently-applied view (if any). Used to highlight the matching item
   *  in the menu and disable "Save current" when nothing's changed. */
  activeViewId: string | null;
  /** Snapshot of the page's current filter/sort state to persist on save. */
  currentConfig: Record<string, unknown>;
  /** Apply a view's config to the page state. */
  onApply: (view: SavedView) => void;
  /** Clear all filters/sorts (used by "Reset to default" if no default exists). */
  onClear?: () => void;
}

export default function SavedViewsMenu({
  resource,
  activeViewId,
  currentConfig,
  onApply,
  onClear,
}: SavedViewsMenuProps) {
  const { views, isLoading, create, update, remove } = useSavedViews(resource);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false), open);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const activeView = views.find((v) => v.id === activeViewId);

  const handleSaveAs = async (name: string, asDefault: boolean) => {
    try {
      await create.mutateAsync({
        resource,
        name,
        config: currentConfig,
        isDefault: asDefault,
      });
      setSaveDialogOpen(false);
      setOpen(false);
    } catch (err) {
      window.alert(getApiErrorMessage(err, "Failed to save view"));
    }
  };

  const handleRename = async (id: string, name: string) => {
    try {
      await update.mutateAsync({ id, name });
      setRenamingId(null);
    } catch (err) {
      window.alert(getApiErrorMessage(err, "Failed to rename view"));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await update.mutateAsync({ id, isDefault: true });
    } catch (err) {
      window.alert(getApiErrorMessage(err, "Failed to set default"));
    }
  };

  const handleDelete = async (view: SavedView) => {
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    try {
      await remove.mutateAsync(view.id);
    } catch (err) {
      window.alert(getApiErrorMessage(err, "Failed to delete view"));
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        data-tour="saved-views-menu"
      >
        <span className="text-muted-foreground">View:</span>
        <span>{activeView?.name ?? "Default"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 rounded-md border bg-card shadow-lg">
          {/* Save current as view */}
          <button
            type="button"
            onClick={() => {
              setSaveDialogOpen(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 border-b px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Save className="h-3.5 w-3.5" />
            Save current as new view...
          </button>

          {/* Default / clear */}
          <button
            type="button"
            onClick={() => {
              onClear?.();
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 border-b px-3 py-2 text-sm hover:bg-accent",
              !activeView && "bg-accent/40",
            )}
          >
            <span className="inline-block h-3.5 w-3.5" />
            Default (no saved view)
            {!activeView && <Check className="ml-auto h-3.5 w-3.5" />}
          </button>

          {/* Saved view list */}
          {isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Loading...
            </p>
          ) : views.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No saved views yet. Configure filters/sorts and save them above.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {views.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent",
                    v.id === activeViewId && "bg-accent/60",
                  )}
                >
                  {/* Default star (filled when this is the default) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSetDefault(v.id);
                    }}
                    title={v.isDefault ? "Default view" : "Set as default"}
                    className={cn(
                      "shrink-0",
                      v.isDefault
                        ? "text-yellow-500"
                        : "text-muted-foreground/40 hover:text-yellow-500",
                    )}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      fill={v.isDefault ? "currentColor" : "none"}
                    />
                  </button>

                  {/* Name — click to apply, double-click to rename */}
                  {renamingId === v.id ? (
                    <input
                      autoFocus
                      defaultValue={v.name}
                      onBlur={(e) => void handleRename(v.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onApply(v);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 truncate text-left"
                    >
                      {v.name}
                    </button>
                  )}

                  {v.id === activeViewId && <Check className="h-3.5 w-3.5 text-primary" />}

                  {/* Hover actions */}
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(v.id);
                      }}
                      title="Rename"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(v);
                      }}
                      title="Delete"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {saveDialogOpen && (
        <SaveViewDialog
          existingNames={views.map((v) => v.name.toLowerCase())}
          onCancel={() => setSaveDialogOpen(false)}
          onSave={(name, asDefault) => void handleSaveAs(name, asDefault)}
        />
      )}
    </div>
  );
}

// ── Save dialog ──────────────────────────────────────────────────────
// Tiny modal: name + optional "set as default" checkbox. We block save on
// duplicate names (case-insensitive) so the user doesn't end up with
// "Laptop" and "laptop" side by side.

interface SaveViewDialogProps {
  existingNames: string[];
  onCancel: () => void;
  onSave: (name: string, asDefault: boolean) => void;
}

function SaveViewDialog({ existingNames, onCancel, onSave }: SaveViewDialogProps) {
  const [name, setName] = useState("");
  const [asDefault, setAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (existingNames.includes(trimmed.toLowerCase())) {
      setError("A view with this name already exists.");
      return;
    }
    onSave(trimmed, asDefault);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-view-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg">
        <h2 id="save-view-title" className="mb-3 text-base font-semibold">
          Save current view
        </h2>
        <label className="mb-1 block text-sm font-medium" htmlFor="sv-name">
          Name
        </label>
        <input
          id="sv-name"
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="e.g. Laptops di Pondok Indah"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={asDefault}
            onChange={(e) => setAsDefault(e.target.checked)}
          />
          Set as my default view
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save view
          </button>
        </div>
      </div>
    </div>
  );
}
