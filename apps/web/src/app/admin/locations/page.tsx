"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiDelete } from "@/lib/api";
import { cn } from "@/lib/utils";
import LocationFormDialog from "@/components/shared/location-form-dialog";
import type { LocationNode, LocationFlat } from "@/types/admin";

// ── Tree node component ──────────────────────────────────────────────
function LocationTreeNode({
  node,
  depth,
  onEdit,
  onDelete,
}: {
  node: LocationNode;
  depth: number;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent",
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted-foreground",
            !hasChildren && "invisible",
          )}
        >
          {expanded ? "▼" : "▶"}
        </button>

        {/* Name */}
        <span className="font-medium text-sm">{node.name}</span>

        {/* Code */}
        <span className="text-xs text-muted-foreground">({node.code})</span>

        {/* Type badge */}
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          {node.type}
        </span>

        {/* Status */}
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            node.isActive
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800",
          )}
        >
          {node.isActive ? "Active" : "Inactive"}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <button
          type="button"
          onClick={() => onEdit(node.id)}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          Delete
        </button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <LocationTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function LocationsPage() {
  const [tree, setTree] = useState<LocationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationFlat | null>(
    null,
  );

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<LocationNode[]>("/api/locations/tree");
      setTree(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  const handleEdit = async (id: string) => {
    try {
      const loc = await apiGet<LocationFlat>(`/api/locations/${id}`);
      setEditingLocation(loc);
      setDialogOpen(true);
    } catch {
      // handle error
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this location?")) return;
    try {
      await apiDelete(`/api/locations/${id}`);
      void fetchTree();
    } catch {
      // handle error
    }
  };

  const handleAdd = () => {
    setEditingLocation(null);
    setDialogOpen(true);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
        <button
          type="button"
          onClick={handleAdd}
          data-tour="add-location-btn"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add Location
        </button>
      </div>

      <div
        data-tour="location-tree"
        className="rounded-lg border bg-card p-4"
      >
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading locations...
          </p>
        ) : tree.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No locations found. Click &quot;Add Location&quot; to create one.
          </p>
        ) : (
          tree.map((node) => (
            <LocationTreeNode
              key={node.id}
              node={node}
              depth={0}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      <LocationFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void fetchTree()}
        editingLocation={editingLocation}
      />
    </div>
  );
}
