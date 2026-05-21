"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Archive, ChevronDown, ChevronRight, Plus, Search, Upload, X } from "lucide-react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import LocationFormDialog from "@/components/shared/location-form-dialog";
import LocationArchiveDialog from "@/components/shared/location-archive-dialog";
import { getLocationTypeLabel } from "@/lib/location-types";
import type { LocationNode, LocationFlat } from "@/types/admin";

// ── Filter helpers ───────────────────────────────────────────────────
//
// "Ancestor-preserve" filtering: when a node matches the query we keep the
// node AND all of its ancestors so the user can read the hierarchy context
// (matching "Lantai 2" alone is useless without the "Head Office → Jakarta"
// path above it). We also keep all descendants of a matching node so the
// user can still drill in. Mirrors the pattern used in location-tree-picker.

// Drop archived (isActive=false) subtrees from the view. We hide the whole
// branch — not just the inactive node — because descendants of an archived
// parent are usually orphaned context and would clutter the list. Flip the
// `Show archived` toggle to bring them back.
function filterActive(nodes: LocationNode[]): LocationNode[] {
  return nodes
    .filter((n) => n.isActive)
    .map((n) => ({ ...n, children: filterActive(n.children) }));
}

function filterTree(nodes: LocationNode[], query: string): LocationNode[] {
  if (!query.trim()) return nodes;
  const q = query.trim().toLowerCase();

  function visit(node: LocationNode): LocationNode | null {
    const selfMatches =
      node.name.toLowerCase().includes(q) ||
      node.code.toLowerCase().includes(q);
    const filteredChildren = node.children
      .map(visit)
      .filter((c): c is LocationNode => c !== null);
    if (selfMatches || filteredChildren.length > 0) {
      // If self matches, keep all original children (lets user drill in).
      // If only a descendant matches, narrow to the matching subtree.
      return { ...node, children: selfMatches ? node.children : filteredChildren };
    }
    return null;
  }

  return nodes.map(visit).filter((n): n is LocationNode => n !== null);
}

// Flatten the filtered tree into the *visible* order (respecting expansion
// state) so we can compute next/prev for keyboard navigation in O(1).
function flattenVisible(
  nodes: LocationNode[],
  expanded: Set<string>,
  forceExpand: boolean,
): LocationNode[] {
  const out: LocationNode[] = [];
  function walk(list: LocationNode[]) {
    for (const n of list) {
      out.push(n);
      if (n.children.length > 0 && (forceExpand || expanded.has(n.id))) {
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return out;
}

// ── Tree row ─────────────────────────────────────────────────────────

interface TreeRowProps {
  node: LocationNode;
  depth: number;
  isExpanded: boolean;
  isFocused: boolean;
  hasChildren: boolean;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
}

function TreeRow({
  node,
  depth,
  isExpanded,
  isFocused,
  hasChildren,
  onToggle,
  onFocus,
  onEdit,
  onArchive,
}: TreeRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  // Roving tabindex: only the focused row participates in tab order. When
  // focus state flips to this row we proactively scroll/focus it so keyboard
  // navigation feels native.
  useEffect(() => {
    if (isFocused && rowRef.current) {
      rowRef.current.focus({ preventScroll: false });
    }
  }, [isFocused]);

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      aria-selected={isFocused}
      tabIndex={isFocused ? 0 : -1}
      onFocus={() => onFocus(node.id)}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/50",
        isFocused && "bg-accent/60",
        // Archived branches stay visible (when "Show archived" is on) but
        // muted so the active hierarchy reads as the foreground.
        !node.isActive && "opacity-60",
      )}
      style={{ paddingLeft: `${depth * 20 + 8}px` }}
    >
      {/* Expand/collapse toggle. Click-only — keyboard handles via the
          tree container's onKeyDown (ArrowRight/Left). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggle(node.id);
        }}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        tabIndex={-1}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted",
          !hasChildren && "invisible",
        )}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Name + code. Name links to detail page; click on the row body still
          moves keyboard focus here but does not navigate (Enter triggers Edit
          per keyboard nav contract). */}
      <Link
        href={`/admin/locations/${node.id}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        className="truncate text-sm font-medium hover:text-primary hover:underline"
      >
        {node.name}
      </Link>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        ({node.code})
      </span>

      {/* Type badge — humanised label, not the raw enum value. */}
      <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground md:inline">
        {getLocationTypeLabel(node.type)}
      </span>

      {/* Asset count. Show subtree total; the direct count is a tooltip for
          power users to see the breakdown. Hide when zero to avoid visual
          noise on freshly-created locations. */}
      {node.subtreeAssetCount > 0 && (
        <span
          title={
            hasChildren
              ? `${node.directAssetCount} direct · ${node.subtreeAssetCount} in subtree`
              : `${node.subtreeAssetCount} asset${node.subtreeAssetCount === 1 ? "" : "s"}`
          }
          className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline"
        >
          {node.subtreeAssetCount}
          <span className="ml-1 text-[10px] opacity-70">
            asset{node.subtreeAssetCount === 1 ? "" : "s"}
          </span>
        </span>
      )}

      {/* Status — only render the badge for archived nodes. Active is the
          default, no need to announce it on every row (cuts visual noise). */}
      {!node.isActive && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Archived
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions — visible on hover/focus only to keep the tree scannable.
          On mobile (no hover) they stay visible so users can tap. */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:max-lg:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(node.id);
          }}
          tabIndex={-1}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(node.id);
          }}
          tabIndex={-1}
          disabled={!node.isActive}
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50",
            node.isActive
              ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              : "text-muted-foreground",
          )}
        >
          <Archive className="h-3 w-3" />
          {node.isActive ? "Archive" : "Archived"}
        </button>
      </div>
    </div>
  );
}

// Recursive render — the parent passes the expansion state map so a single
// React subtree handles all rows without prop-drilling refs for focus.
interface RecursiveTreeProps {
  nodes: LocationNode[];
  depth: number;
  expanded: Set<string>;
  forceExpand: boolean;
  focusedId: string | null;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
}

function RecursiveTree({
  nodes,
  depth,
  expanded,
  forceExpand,
  focusedId,
  onToggle,
  onFocus,
  onEdit,
  onArchive,
}: RecursiveTreeProps) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = forceExpand || expanded.has(node.id);
        return (
          <div key={node.id} role="group">
            <TreeRow
              node={node}
              depth={depth}
              isExpanded={isExpanded}
              isFocused={focusedId === node.id}
              hasChildren={hasChildren}
              onToggle={onToggle}
              onFocus={onFocus}
              onEdit={onEdit}
              onArchive={onArchive}
            />
            {hasChildren && isExpanded && (
              <RecursiveTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                forceExpand={forceExpand}
                focusedId={focusedId}
                onToggle={onToggle}
                onFocus={onFocus}
                onEdit={onEdit}
                onArchive={onArchive}
              />
            )}
          </div>
        );
      })}
    </>
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
  const [archivingLocation, setArchivingLocation] = useState<LocationFlat | null>(
    null,
  );

  // Search query — empty string means "show full tree, respect manual expand".
  const [query, setQuery] = useState("");

  // Show-archived toggle. Off by default — archived locations stay out of
  // the way until the user explicitly asks to see them. The filter prunes
  // archived subtrees entirely (an archived branch hides its descendants
  // from the default view too); flip the toggle to inspect them.
  const [showArchived, setShowArchived] = useState(false);

  // Expansion state: only root level expanded by default. Deep nodes stay
  // collapsed unless the user clicks them OR a search is active (forceExpand
  // takes over). Using a Set keeps toggle ops O(1).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Roving-tabindex focus tracking for keyboard navigation. null = no row has
  // been focused yet (focus moves into the tree on first ArrowDown).
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<LocationNode[]>("/api/locations/tree");
      setTree(data);
      // Seed expansion: top-level roots open by default so the user sees the
      // shape immediately. Deeper levels are user-driven.
      setExpanded(new Set(data.map((n) => n.id)));
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  // Apply archive filter first (drop inactive subtrees), then search.
  const filteredTree = useMemo(() => {
    const base = showArchived ? tree : filterActive(tree);
    return filterTree(base, query);
  }, [tree, query, showArchived]);
  const forceExpand = query.trim().length > 0;
  const visibleNodes = useMemo(
    () => flattenVisible(filteredTree, expanded, forceExpand),
    [filteredTree, expanded, forceExpand],
  );

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Keyboard nav. Standard ARIA tree pattern subset — covers what users
  // actually reach for. Type-ahead and Home/End jumps are deferred until
  // there's evidence they're needed.
  const handleTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (visibleNodes.length === 0) return;
    const currentIdx = focusedId
      ? visibleNodes.findIndex((n) => n.id === focusedId)
      : -1;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, visibleNodes.length - 1);
        setFocusedId(visibleNodes[next]!.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = currentIdx <= 0 ? 0 : currentIdx - 1;
        setFocusedId(visibleNodes[next]!.id);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (currentIdx < 0) return;
        const node = visibleNodes[currentIdx]!;
        if (node.children.length === 0) return;
        if (!expanded.has(node.id) && !forceExpand) {
          toggle(node.id);
        } else if (currentIdx + 1 < visibleNodes.length) {
          // Already expanded — step into first child.
          setFocusedId(visibleNodes[currentIdx + 1]!.id);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (currentIdx < 0) return;
        const node = visibleNodes[currentIdx]!;
        if (node.children.length > 0 && (expanded.has(node.id) || forceExpand) && !forceExpand) {
          toggle(node.id);
        } else {
          // Step to parent: walk backwards for the first row at shallower depth.
          // Re-derive depth by scanning the filtered tree — fine for small trees.
          const ancestor = findAncestor(filteredTree, node.id);
          if (ancestor) setFocusedId(ancestor.id);
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        setFocusedId(visibleNodes[0]!.id);
        break;
      }
      case "End": {
        e.preventDefault();
        setFocusedId(visibleNodes[visibleNodes.length - 1]!.id);
        break;
      }
      case "Enter": {
        if (currentIdx < 0) return;
        e.preventDefault();
        void handleEdit(visibleNodes[currentIdx]!.id);
        break;
      }
    }
  };

  const handleEdit = async (id: string) => {
    try {
      const loc = await apiGet<LocationFlat>(`/api/locations/${id}`);
      setEditingLocation(loc);
      setDialogOpen(true);
    } catch {
      // handle error
    }
  };

  const handleArchive = async (id: string) => {
    // Need the full LocationFlat for the dialog (it inspects fields like
    // direct asset count via a fetch on open). Pulling here keeps the row
    // action simple: click → open dialog.
    try {
      const loc = await apiGet<LocationFlat>(`/api/locations/${id}`);
      setArchivingLocation(loc);
    } catch {
      // handle error
    }
  };

  const handleAdd = () => {
    setEditingLocation(null);
    setDialogOpen(true);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage office locations, branches, and sub-locations
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <Link
            href="/admin/locations/import"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <Upload className="h-4 w-4" />
            Import
          </Link>
          <button
            type="button"
            onClick={handleAdd}
            data-tour="add-location-btn"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Location
          </button>
        </div>
      </div>

      {/* Search bar + filters row. Search is debounce-free because the tree
          is small (<200 nodes typical) and filtering is pure O(n). */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search locations by name or code…"
            className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Search locations"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Show archived
        </label>
      </div>

      <div
        data-tour="location-tree"
        className="rounded-lg border bg-card p-2"
        // Container takes focus when user tabs into the tree. The roving
        // tabindex on individual rows handles arrow-key nav from there.
        onKeyDown={handleTreeKeyDown}
        role="tree"
        aria-label="Locations hierarchy"
      >
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading locations…
          </p>
        ) : tree.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No locations found. Click &quot;Add Location&quot; to create one.
          </p>
        ) : filteredTree.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No locations match &quot;{query}&quot;.
          </p>
        ) : (
          <RecursiveTree
            nodes={filteredTree}
            depth={0}
            expanded={expanded}
            forceExpand={forceExpand}
            focusedId={focusedId}
            onToggle={toggle}
            onFocus={setFocusedId}
            onEdit={handleEdit}
            onArchive={handleArchive}
          />
        )}
      </div>

      <LocationFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void fetchTree()}
        editingLocation={editingLocation}
      />

      {/* Archive flow — opens when an active row's Archive button fires.
          Closes after success (which fetches the tree again to reflect the
          new isActive state). */}
      {archivingLocation && (
        <LocationArchiveDialog
          open={true}
          onClose={() => setArchivingLocation(null)}
          location={archivingLocation}
          onArchived={() => {
            setArchivingLocation(null);
            void fetchTree();
          }}
        />
      )}
    </div>
  );
}

// Walk the tree to find a node's parent. O(n) per call — fine for our scale.
// Used by ArrowLeft to navigate up out of a leaf.
function findAncestor(
  nodes: LocationNode[],
  childId: string,
  parent: LocationNode | null = null,
): LocationNode | null {
  for (const n of nodes) {
    if (n.id === childId) return parent;
    if (n.children.length > 0) {
      const found = findAncestor(n.children, childId, n);
      if (found !== null) return found;
    }
  }
  return null;
}
