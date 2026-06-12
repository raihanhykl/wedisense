"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FolderTree, Search, X } from "lucide-react";
import { useOutsideClick } from "@/hooks/use-outside-click";
import { cn } from "@/lib/utils";

// ── Category tree picker ─────────────────────────────────────────────
// Dropdown tree for choosing a category — used as the Parent picker in the
// category form. Mirrors LocationTreePicker's interaction pattern, but the
// categories endpoint returns a flat list (there is no /tree endpoint), so
// the tree is assembled client-side from parentId links.

export interface CategoryTreeItem {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  color?: string | null;
}

interface CategoryTreeNode extends CategoryTreeItem {
  children: CategoryTreeNode[];
}

interface CategoryTreePickerProps {
  /** Currently selected category id, or null for none. */
  value: string | null;
  /** Called with the selected id, or null when the user clears. */
  onChange: (id: string | null) => void;
  /** Flat category list — tree is built from parentId links. */
  categories: CategoryTreeItem[];
  /** Exclude this category AND its descendants from the tree. Used when
   *  editing so a category can never be moved under its own subtree
   *  (which would create a parent cycle). */
  excludeId?: string | null;
  placeholder?: string;
  /** Label for the "clear selection" row at the top of the dropdown. */
  clearLabel?: string;
  /** id for the trigger button so a <label htmlFor> can target it. */
  id?: string;
  /** Width/layout overrides for the root container (defaults to full width). */
  className?: string;
  /** Forwarded to the trigger button so tours can target a specific picker
   *  instance. Pass it as a literal so tour:codegen picks it up. */
  "data-tour"?: string;
}

/** ids of `rootId` itself plus every descendant, walked via parentId links. */
function collectSubtreeIds(rootId: string, categories: CategoryTreeItem[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c.id);
    childrenOf.set(c.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!out.has(childId)) {
        out.add(childId);
        queue.push(childId);
      }
    }
  }
  return out;
}

export default function CategoryTreePicker({
  value,
  onChange,
  categories,
  excludeId = null,
  placeholder = "Select category",
  clearLabel = "— None —",
  id,
  className,
  "data-tour": dataTour,
}: CategoryTreePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideClick(containerRef, () => setOpen(false), open);

  const tree = useMemo(() => {
    const excluded = excludeId ? collectSubtreeIds(excludeId, categories) : new Set<string>();
    const visible = categories.filter((c) => !excluded.has(c.id));
    const visibleIds = new Set(visible.map((c) => c.id));

    const nodes = new Map<string, CategoryTreeNode>(
      visible.map((c) => [c.id, { ...c, children: [] }]),
    );
    const roots: CategoryTreeNode[] = [];
    for (const c of visible) {
      const node = nodes.get(c.id)!;
      // A missing parent (soft-deleted, or just excluded above) promotes the
      // node to root rather than hiding it.
      const parent = node.parentId && visibleIds.has(node.parentId)
        ? nodes.get(node.parentId)
        : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    const sortRec = (list: CategoryTreeNode[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }, [categories, excludeId]);

  // Breadcrumb-style label for the selection ("IT Equipment / Notebook") so
  // the chosen parent is unambiguous even with duplicate-ish names.
  const selectedLabel = useMemo(() => {
    if (!value) return null;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const names: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(value);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return names.length > 0 ? names.join(" / ") : null;
  }, [value, categories]);

  // Filter the tree by name/code, keeping ancestors of any match so the
  // hierarchy stays interpretable. Empty query → full tree.
  const filteredTree = useMemo(() => {
    if (!query.trim()) return tree;
    const q = query.trim().toLowerCase();

    function filterNode(node: CategoryTreeNode): CategoryTreeNode | null {
      const selfMatches =
        node.name.toLowerCase().includes(q) || node.code.toLowerCase().includes(q);
      const filteredChildren = node.children
        .map(filterNode)
        .filter((c): c is CategoryTreeNode => c !== null);
      if (selfMatches || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    }

    return tree.map(filterNode).filter((n): n is CategoryTreeNode => n !== null);
  }, [tree, query]);

  const handleSelect = (selectedId: string | null) => {
    onChange(selectedId);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/50"
        data-tour={dataTour}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel ?? placeholder}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-[18rem] rounded-md border bg-card shadow-lg">
          {/* Search */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search categories..."
                className="w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Clear option */}
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className={cn(
              "flex w-full items-center gap-2 border-b px-3 py-2 text-sm hover:bg-accent",
              !value && "bg-accent/40",
            )}
          >
            <span className="inline-block h-3.5 w-3.5" />
            <span>{clearLabel}</span>
            {!value && <X className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
          </button>

          {/* Tree */}
          <div className="max-h-72 overflow-y-auto py-1">
            {filteredTree.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                {query ? `No categories match "${query}"` : "No categories available."}
              </p>
            ) : (
              <ul>
                {filteredTree.map((node) => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={value}
                    // When searching, auto-expand so matches at any depth are
                    // visible without manual fiddling.
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
// Category trees are shallow (1-3 levels in practice), so unlike the
// location picker every branch starts expanded.

interface TreeNodeProps {
  node: CategoryTreeNode;
  depth: number;
  selectedId: string | null;
  forceExpand: boolean;
  onSelect: (id: string) => void;
}

function TreeNode({ node, depth, selectedId, forceExpand, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
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
        {/* Expand/collapse toggle. Invisible (but keeps spacing) for leaves. */}
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
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {node.color && (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border"
              style={{ backgroundColor: node.color }}
              aria-hidden
            />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <span className="font-mono text-[10px] text-muted-foreground/70">{node.code}</span>
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
