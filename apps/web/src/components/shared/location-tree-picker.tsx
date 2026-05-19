"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search, X, MapPin } from "lucide-react";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { useLocationTree, type LocationTreeNode } from "@/hooks/use-reference-data";
import { cn } from "@/lib/utils";

interface LocationTreePickerProps {
  /** Currently selected location id, or null for "All locations". */
  value: string | null;
  /** Called with the selected id, or null when user clears. */
  onChange: (id: string | null) => void;
  /** Visible placeholder label when nothing is selected. */
  placeholder?: string;
}

export default function LocationTreePicker({
  value,
  onChange,
  placeholder = "All locations",
}: LocationTreePickerProps) {
  const { data: tree = [], isLoading } = useLocationTree();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false), open);

  // Flatten the tree once for the "find selected node's name" lookup. The
  // tree is small (<200 locations typical), so a flat walk is fine.
  const flatNodes = useMemo(() => {
    const out: Array<LocationTreeNode & { depth: number }> = [];
    function walk(nodes: LocationTreeNode[], depth: number) {
      for (const n of nodes) {
        out.push({ ...n, depth });
        if (n.children.length > 0) walk(n.children, depth + 1);
      }
    }
    walk(tree, 0);
    return out;
  }, [tree]);

  const selectedNode = useMemo(
    () => (value ? flatNodes.find((n) => n.id === value) : null),
    [value, flatNodes],
  );

  // Filter tree by search query. We keep ancestors of any matching node so
  // the hierarchy stays interpretable (matching "Lantai 2" alone is useless
  // without showing it sits under "Head Office"). When the query is empty,
  // show the full tree.
  const filteredTree = useMemo(() => {
    if (!query.trim()) return tree;
    const q = query.trim().toLowerCase();

    function filterNode(node: LocationTreeNode): LocationTreeNode | null {
      const selfMatches =
        node.name.toLowerCase().includes(q) ||
        node.code.toLowerCase().includes(q);
      const filteredChildren = node.children
        .map(filterNode)
        .filter((c): c is LocationTreeNode => c !== null);
      if (selfMatches || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }

    return tree
      .map(filterNode)
      .filter((n): n is LocationTreeNode => n !== null);
  }, [tree, query]);

  const handleSelect = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-w-[12rem] items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent"
        data-tour="location-tree-picker"
      >
        <span className="flex items-center gap-1.5 truncate">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !selectedNode && "text-muted-foreground")}>
            {selectedNode ? selectedNode.name : placeholder}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-80 rounded-md border bg-card shadow-lg">
          {/* Search */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search locations..."
                className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* All locations option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={cn(
              "flex w-full items-center gap-2 border-b px-3 py-2 text-sm hover:bg-accent",
              !value && "bg-accent/40",
            )}
          >
            <span className="inline-block h-3.5 w-3.5" />
            <span>All locations</span>
            {!value && <X className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
          </button>

          {/* Tree */}
          <div className="max-h-80 overflow-y-auto py-1">
            {isLoading ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Loading locations...
              </p>
            ) : filteredTree.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {query
                  ? `No locations match "${query}"`
                  : "No locations configured yet."}
              </p>
            ) : (
              <ul>
                {filteredTree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={value}
                    // When searching, auto-expand everything so matches at
                    // any depth are visible without manual fiddling.
                    forceExpand={query.length > 0}
                    onSelect={handleSelect}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recursive tree row ───────────────────────────────────────────────
// Expansion is local state per node. We do NOT default-expand inactive
// branches so a tree with 100s of legacy locations stays scrollable; the
// user can drill into branches they care about.

interface TreeNodeProps {
  node: LocationTreeNode;
  depth: number;
  selectedId: string | null;
  forceExpand: boolean;
  onSelect: (id: string) => void;
}

function TreeNode({
  node,
  depth,
  selectedId,
  forceExpand,
  onSelect,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0); // top level open by default
  const isExpanded = forceExpand || expanded;
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1 text-sm hover:bg-accent",
          isSelected && "bg-accent/60 font-medium",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse toggle. Invisible (but keeps spacing) for leaf nodes. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground",
            !hasChildren && "invisible",
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="min-w-0 flex-1 truncate text-left"
        >
          {node.name}
          {!node.isActive && (
            <span className="ml-1 text-[10px] text-muted-foreground">(inactive)</span>
          )}
        </button>
        <span className="text-[10px] text-muted-foreground/70">{node.code}</span>
      </div>

      {hasChildren && isExpanded && (
        <ul>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              forceExpand={forceExpand}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
