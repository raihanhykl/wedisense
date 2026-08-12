"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { apiGetPaginated } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { useOutsideClick } from "@/hooks/use-outside-click";
import type { AssetListItem } from "@/types/admin";

/** One line on the form: the chosen asset plus its optional remark. */
export interface PickedAsset {
  assetId: string;
  assetNumber: string;
  assetName: string;
  serialNumber: string | null;
  condition: string;
  itemNotes: string;
}

interface HandoverAssetPickerProps {
  value: PickedAsset[];
  onChange: (assets: PickedAsset[]) => void;
  /**
   * When set, offers a one-click "add everything this employee holds"
   * shortcut — the resignation-return case, where listing 8 assets by hand
   * is where mistakes creep in.
   */
  bulkFromUserId?: string | null;
  bulkFromUserName?: string | null;
  disabled?: boolean;
}

function toPicked(asset: AssetListItem): PickedAsset {
  return {
    assetId: asset.id,
    assetNumber: asset.assetNumber,
    assetName: asset.name,
    serialNumber: asset.serialNumber,
    condition: asset.condition,
    itemNotes: "",
  };
}

export default function HandoverAssetPicker({
  value,
  onChange,
  bulkFromUserId,
  bulkFromUserName,
  disabled,
}: HandoverAssetPickerProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<AssetListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false));

  const pickedIds = useMemo(() => new Set(value.map((v) => v.assetId)), [value]);

  useEffect(() => {
    if (query === debounced) return;
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query, debounced]);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    void (async () => {
      try {
        const res = await apiGetPaginated<AssetListItem[]>("/api/assets", {
          search: debounced.trim(),
          limit: 20,
        });
        if (!cancelled) setResults(res.data);
      } catch (err) {
        if (!cancelled) toast.error(getApiErrorMessage(err, "Asset search failed"));
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const add = (asset: AssetListItem) => {
    if (pickedIds.has(asset.id)) {
      toast.error(`${asset.assetNumber} is already on this form.`);
      return;
    }
    onChange([...value, toPicked(asset)]);
    setQuery("");
    setDebounced("");
    setResults([]);
    setOpen(false);
  };

  const remove = (assetId: string) => {
    onChange(value.filter((v) => v.assetId !== assetId));
  };

  const setNotes = (assetId: string, notes: string) => {
    onChange(value.map((v) => (v.assetId === assetId ? { ...v, itemNotes: notes } : v)));
  };

  const addAllFromUser = async () => {
    if (!bulkFromUserId) return;
    setBulkLoading(true);
    try {
      const res = await apiGetPaginated<AssetListItem[]>("/api/assets", {
        assignedToUserId: bulkFromUserId,
        limit: 100,
      });
      const fresh = res.data.filter((a) => !pickedIds.has(a.id));
      if (fresh.length === 0) {
        toast.info(
          res.data.length === 0
            ? "That employee currently holds no assets."
            : "All of that employee's assets are already listed.",
        );
        return;
      }
      onChange([...value, ...fresh.map(toPicked)]);
      toast.success(`Added ${fresh.length} asset(s)`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load the employee's assets"));
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div ref={containerRef} className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            disabled={disabled}
            placeholder="Search asset number, name or serial…"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary disabled:opacity-60"
          />

          {open && debounced.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-lg">
              {searching ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No assets match “{debounced}”.
                </div>
              ) : (
                results.map((asset) => {
                  const already = pickedIds.has(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      disabled={already}
                      onClick={() => add(asset)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60 disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{asset.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {asset.assetNumber}
                          {asset.serialNumber ? ` · SN ${asset.serialNumber}` : ""}
                          {asset.assignedTo ? ` · held by ${asset.assignedTo.name}` : ""}
                        </span>
                      </span>
                      {already ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Added</span>
                      ) : (
                        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {bulkFromUserId && (
          <button
            type="button"
            onClick={addAllFromUser}
            disabled={disabled || bulkLoading}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
          >
            {bulkLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Add all assets held by {bulkFromUserName ?? "this employee"}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2 text-left font-medium">#</th>
              <th className="px-3 py-2 text-left font-medium">Asset</th>
              <th className="px-3 py-2 text-left font-medium">Serial</th>
              <th className="px-3 py-2 text-left font-medium">Condition</th>
              <th className="px-3 py-2 text-left font-medium">Remarks</th>
              <th className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No assets on this form yet. Search above to add one.
                </td>
              </tr>
            ) : (
              value.map((item, index) => (
                <tr key={item.assetId} className="border-b last:border-b-0">
                  <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.assetName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {item.assetNumber}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{item.serialNumber ?? "—"}</td>
                  <td className="px-3 py-2">
                    {/* Read-only: the condition printed on the form is snapshotted
                        server-side from the asset record, so it always matches
                        what the receiver is actually signing for. */}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {item.condition}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={item.itemNotes}
                      disabled={disabled}
                      maxLength={500}
                      placeholder="e.g. charger included"
                      onChange={(e) => setNotes(item.assetId, e.target.value)}
                      className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus:border-primary disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(item.assetId)}
                      disabled={disabled}
                      aria-label={`Remove ${item.assetNumber}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {value.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {value.length} asset{value.length === 1 ? "" : "s"} on this form.
        </p>
      )}
    </div>
  );
}
