"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Copy,
  GitCompare,
  History,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGet, apiPut, apiPost, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import {
  PERMISSION_PRESETS,
  resolvePresetIds,
  type PermissionPreset,
} from "@/lib/permission-presets";
import type { Role, Permission } from "@/types/admin";

interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  oldValues: unknown;
  newValues: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

interface AuditHistoryResponse {
  rows: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ── Roles:manage detection ───────────────────────────────────────────
//
// The single permission whose removal can lock the entire system out of
// role management. Detection is by (resource, action) tuple rather than
// permission UUID so seeds across environments stay portable.
function isRolesManage(p: { resource: string; action: string }): boolean {
  return p.resource === "roles" && p.action === "manage";
}

interface AffectedUser {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  locationScope: { id: string; name: string; code: string } | null;
}

// ── Permission grouping helpers ───────────────────────────────────────
//
// The catalog stores permissions as flat (resource, action) pairs. The
// editor renders them grouped by resource into an accordion — each
// section can be collapsed independently. We compute the grouping once
// per allPermissions change, keyed by resource name. The display-name
// mapping mirrors the locale `roles.resources.*` keys for forward
// compatibility with the upcoming i18n wiring.
const RESOURCE_LABELS: Record<string, string> = {
  assets: "Assets",
  movements: "Movements",
  maintenance: "Maintenance",
  reports: "Reports",
  users: "Users",
  roles: "Roles",
  audit: "Audit",
  labels: "Labels",
  tours: "Tours",
  categories: "Categories",
  "purchase-orders": "Purchase Orders",
  procurement: "Procurement",
  vendors: "Vendors",
};

function labelForResource(resource: string): string {
  return (
    RESOURCE_LABELS[resource] ??
    resource.charAt(0).toUpperCase() + resource.slice(1)
  );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  // Set.forEach avoids needing tsconfig downlevelIteration; for the
  // <200-item permission catalog the iteration cost is negligible.
  let equal = true;
  a.forEach((v) => {
    if (!b.has(v)) equal = false;
  });
  return equal;
}

// ── Role Creation Dialog ─────────────────────────────────────────────
function RoleCreateDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await apiPost("/api/roles", { name, description });
      toast.success(`Role "${name}" created`);
      onSuccess();
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Failed to create role"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Add Role</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Permission Editor Panel ──────────────────────────────────────────
//
// Resource-grouped accordion + inline search + explicit commit pattern.
// The flat-list editor it replaces could not scale past ~20 permissions
// without scrolling fatigue; the accordion + search keeps the catalog
// scannable as the system grows.
//
// State model: `selectedIds` is the in-flight Set of permission IDs.
// `originalIds` captures the saved baseline so we can compute the diff
// and detect `isDirty`. Sets give O(1) toggle + lookup; for 60-100
// checkboxes this is more than enough — no virtualization needed.
function PermissionEditor({
  role,
  onClose,
}: {
  role: Role;
  onClose: () => void;
}) {
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Affected users — loaded lazily when the diff modal opens.
  const [affectedUsers, setAffectedUsers] = useState<AffectedUser[] | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  // Self-demote typed confirmation input — controlled, validated against
  // the literal "CONFIRM" before the Save button enables.
  const [confirmInput, setConfirmInput] = useState("");

  const authUser = useAuthStore((s) => s.user);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [perms, rolePerms] = await Promise.all([
          apiGet<Permission[]>("/api/permissions"),
          // /api/roles/:id/permissions returns rolePermission rows with a
          // nested `permission` — destructure to a flat ID list.
          apiGet<Array<{ permission: Permission }>>(
            `/api/roles/${role.id}/permissions`,
          ),
        ]);
        setAllPermissions(perms);
        const ids = new Set(rolePerms.map((rp) => rp.permission.id));
        setOriginalIds(ids);
        setSelectedIds(new Set(ids));
      } catch (e) {
        toast.error(getApiErrorMessage(e, "Failed to load permissions"));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [role.id]);

  // System roles: backend rejects permission writes (SYSTEM_ROLE_PROTECTED)
  // so checkboxes are disabled and the diff/save UI is hidden. Admin who
  // wants to customise must clone (Tier 5).
  const readOnly = role.isSystem;

  // Group permissions by resource, sorted alphabetically. Memoised so
  // the section list is stable across re-renders of unrelated state
  // (search query, expand/collapse).
  const groups = useMemo(() => {
    const map: Record<string, Permission[]> = {};
    for (const p of allPermissions) {
      (map[p.resource] ??= []).push(p);
    }
    return Object.entries(map)
      .map(([resource, perms]) => ({
        resource,
        label: labelForResource(resource),
        perms: perms.sort((a, b) => a.action.localeCompare(b.action)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allPermissions]);

  // Filter for search. We do NOT hide non-matching sections — they're
  // greyed out with `opacity-40 pointer-events-none` per the
  // Hidden-vs-Disabled UX research (preserves catalog discoverability
  // while letting power users declutter visually).
  const trimmedQuery = query.trim().toLowerCase();
  const matchedResources = useMemo(() => {
    if (!trimmedQuery) return null; // null = all match
    const matched = new Set<string>();
    for (const g of groups) {
      if (g.label.toLowerCase().includes(trimmedQuery)) {
        matched.add(g.resource);
        continue;
      }
      if (g.perms.some((p) => p.action.toLowerCase().includes(trimmedQuery))) {
        matched.add(g.resource);
      }
    }
    return matched;
  }, [groups, trimmedQuery]);

  const togglePermission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSectionAll = (resource: string, enable: boolean) => {
    const ids = groups.find((g) => g.resource === resource)?.perms.map((p) => p.id) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (enable) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleSectionCollapsed = (resource: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });
  };

  const isDirty = !setsEqual(selectedIds, originalIds);

  // Diff for the review modal: which IDs were added since last save,
  // which were removed. Lookup table for resource:action labels so the
  // modal renders human-readable lines, not bare UUIDs.
  const permLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPermissions) m.set(p.id, `${labelForResource(p.resource)} · ${p.action}`);
    return m;
  }, [allPermissions]);

  const diff = useMemo(() => {
    const added: string[] = [];
    const removed: string[] = [];
    selectedIds.forEach((id) => {
      if (!originalIds.has(id)) added.push(id);
    });
    originalIds.forEach((id) => {
      if (!selectedIds.has(id)) removed.push(id);
    });
    return { added, removed, total: added.length + removed.length };
  }, [selectedIds, originalIds]);

  // Detect "is roles:manage being removed" — drives both server-side
  // safety guards (last-admin lockout + self-demote confirmation). We
  // compute it from the diff of resolved Permission objects (not IDs)
  // because the IDs alone don't tell us which permission they map to.
  const isRemovingRolesManage = useMemo(() => {
    const had = allPermissions.some(
      (p) => originalIds.has(p.id) && isRolesManage(p),
    );
    const stillHas = allPermissions.some(
      (p) => selectedIds.has(p.id) && isRolesManage(p),
    );
    return had && !stillHas;
  }, [allPermissions, originalIds, selectedIds]);

  // Self-demote = the current actor holds this role AND is removing
  // roles:manage from it. The server enforces this with a typed-confirm
  // header check; UI surfaces the warning + typed input to match.
  const isSelfDemote = useMemo(() => {
    if (!isRemovingRolesManage || !authUser) return false;
    return authUser.roles.some((r) => r.id === role.id);
  }, [isRemovingRolesManage, authUser, role.id]);

  const confirmAccepted = !isSelfDemote || confirmInput.trim() === "CONFIRM";

  // Fetch affected users when the diff modal opens — lazily, so the
  // network hit only happens when the admin actually wants to review.
  const openDiffModal = async () => {
    setDiffOpen(true);
    setConfirmInput("");
    if (affectedUsers === null) {
      setUsersLoading(true);
      try {
        const users = await apiGet<AffectedUser[]>(`/api/roles/${role.id}/users`);
        setAffectedUsers(users);
      } catch (e) {
        // Don't block the diff — just degrade to count-only view. Toast
        // explains why the list is empty.
        toast.error(getApiErrorMessage(e, "Failed to load affected users"));
        setAffectedUsers([]);
      } finally {
        setUsersLoading(false);
      }
    }
  };

  const handleDiscard = () => {
    setSelectedIds(new Set(originalIds));
    setQuery("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Attach the self-demote confirmation header only when applicable.
      // Server validates the header independently of the client check;
      // sending it unconditionally would defeat the safety guard.
      const headers = isSelfDemote ? { "x-self-demote-confirm": "CONFIRMED" } : undefined;
      await apiPut(
        `/api/roles/${role.id}/permissions`,
        { permissionIds: Array.from(selectedIds) },
        headers,
      );
      toast.success(`Permissions saved for "${role.name}"`);
      setOriginalIds(new Set(selectedIds));
      setDiffOpen(false);
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Failed to save permissions"));
    } finally {
      setSaving(false);
    }
  };

  // Apply a preset = overwrite the in-flight selection with the preset's
  // resolved permission IDs. Goes through the dirty/diff/save flow like
  // any other edit — preset just seeds the state. Confirmation requires
  // explicit user click (no auto-apply on dropdown change) so a misclick
  // doesn't destroy hand-tuned permissions.
  const applyPreset = (preset: PermissionPreset) => {
    const resolved = resolvePresetIds(preset, allPermissions);
    setSelectedIds(resolved);
    toast.success(
      `Applied "${preset.label}" preset (${resolved.size} permissions)`,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-lg">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            Permissions · {role.name}
            {role.isSystem && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                System
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Apply preset (custom roles only — system roles are read-only) */}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Apply preset:
            </span>
            {PERMISSION_PRESETS.map((preset) => (
              <PresetButton
                key={preset.id}
                preset={preset}
                onApply={() => applyPreset(preset)}
              />
            ))}
          </div>
        )}

        {/* Search bar */}
        <div className="border-b px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search permissions…"
              aria-label="Search permissions"
              className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
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
          {trimmedQuery && matchedResources && (
            <p className="mt-2 text-xs text-muted-foreground">
              {matchedResources.size} of {groups.length} section
              {groups.length === 1 ? "" : "s"} match
            </p>
          )}
        </div>

        {/* Read-only banner */}
        {readOnly && (
          <div className="border-b border-blue-200 bg-blue-50 px-5 py-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
            System role permissions are read-only. To customise, create a
            custom role and copy the permissions you need.
          </div>
        )}

        {/* Accordion body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Loading permissions…
            </p>
          ) : groups.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No permissions defined in the catalog.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => {
                const enabledCount = g.perms.filter((p) =>
                  selectedIds.has(p.id),
                ).length;
                const isMatch = !matchedResources || matchedResources.has(g.resource);
                const isExpanded = !collapsed.has(g.resource);
                return (
                  <li
                    key={g.resource}
                    className={cn(
                      "rounded-md border bg-background transition-opacity",
                      !isMatch && "pointer-events-none opacity-40",
                    )}
                  >
                    {/* Section header */}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapsed(g.resource)}
                        aria-expanded={isExpanded}
                        aria-controls={`section-${g.resource}`}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            !isExpanded && "-rotate-90",
                          )}
                        />
                        <span className="text-sm font-medium">{g.label}</span>
                        <SectionBadge enabled={enabledCount} total={g.perms.length} />
                      </button>
                      {!readOnly && (
                        <div className="flex shrink-0 gap-1 text-xs">
                          <button
                            type="button"
                            onClick={() => setSectionAll(g.resource, true)}
                            disabled={enabledCount === g.perms.length}
                            className="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                          >
                            Grant all
                          </button>
                          <button
                            type="button"
                            onClick={() => setSectionAll(g.resource, false)}
                            disabled={enabledCount === 0}
                            className="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                          >
                            Revoke all
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Section body — checkboxes */}
                    {isExpanded && (
                      <div
                        id={`section-${g.resource}`}
                        className="border-t px-4 py-2"
                      >
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {g.perms.map((perm) => (
                            <label
                              key={perm.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-1.5 text-sm",
                                readOnly && "cursor-not-allowed opacity-70",
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                                disabled={readOnly}
                                className="h-4 w-4 rounded border"
                              />
                              <span>{perm.action}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer — sticky save bar in dirty state, plain Close otherwise. */}
        <footer className="flex items-center justify-between border-t bg-card px-5 py-3">
          {!readOnly && isDirty ? (
            <>
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {diff.total} unsaved change{diff.total === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => void openDiffModal()}
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Review & Save…
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                {readOnly ? "Read-only view" : "No pending changes"}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Close
              </button>
            </>
          )}
        </footer>
      </div>

      {/* Diff modal — confirms before commit. Surfaces the exact set of
          permissions being added/removed PLUS the list of users affected
          (not just a count) so the admin can spot mistakes before they
          hit the DB. Self-demote case adds a typed-CONFIRM gate. */}
      {diffOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => !saving && setDiffOpen(false)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border bg-card shadow-lg">
            <header className="border-b px-5 py-3">
              <h3 className="text-base font-semibold">Review changes</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Saving will affect {affectedUsers?.length ?? role.userCount} user
                {(affectedUsers?.length ?? role.userCount) === 1 ? "" : "s"} assigned to {role.name}.
              </p>
            </header>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-3 text-sm">
              {/* Self-demote warning — most prominent visual treatment so
                  it can't be missed. Typed CONFIRM input below. */}
              {isSelfDemote && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                        You are removing admin access from a role you hold
                      </p>
                      <p className="mt-1 text-xs text-amber-900 dark:text-amber-100">
                        After saving, you will no longer be able to manage
                        roles or permissions. This cannot be undone without
                        another admin&apos;s help.
                      </p>
                      <label className="mt-3 block">
                        <span className="block text-xs font-medium text-amber-900 dark:text-amber-100">
                          Type CONFIRM to proceed
                        </span>
                        <input
                          type="text"
                          value={confirmInput}
                          onChange={(e) => setConfirmInput(e.target.value)}
                          placeholder="CONFIRM"
                          autoComplete="off"
                          spellCheck={false}
                          className="mt-1 w-full rounded-md border border-amber-300 bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Permission diff */}
              {diff.added.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-green-700">
                    Adding ({diff.added.length})
                  </p>
                  <ul className="space-y-0.5">
                    {diff.added.map((id) => (
                      <li key={id} className="text-green-700">
                        + {permLabelById.get(id) ?? id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.removed.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700">
                    Removing ({diff.removed.length})
                  </p>
                  <ul className="space-y-0.5">
                    {diff.removed.map((id) => (
                      <li key={id} className="text-red-700">
                        − {permLabelById.get(id) ?? id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Affected users list — count alone is insufficient for an
                  informed decision; admins need to see who specifically is
                  affected. Loaded lazily on modal open. */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Affected users
                </p>
                {usersLoading ? (
                  <p className="text-xs italic text-muted-foreground">
                    Loading users…
                  </p>
                ) : !affectedUsers || affectedUsers.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    No users currently assigned to this role.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border bg-background">
                    {affectedUsers.slice(0, 10).map((u) => (
                      <li
                        key={u.id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{u.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {u.employeeId} · {u.email}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {u.locationScope
                            ? `@ ${u.locationScope.name}`
                            : "global"}
                        </span>
                      </li>
                    ))}
                    {affectedUsers.length > 10 && (
                      <li className="px-3 py-2 text-[11px] text-muted-foreground">
                        … and {affectedUsers.length - 10} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={() => setDiffOpen(false)}
                disabled={saving}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !confirmAccepted}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50",
                  isSelfDemote
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-primary hover:bg-primary/90",
                )}
              >
                {saving
                  ? "Saving…"
                  : isSelfDemote
                    ? "Save — I'll lose access"
                    : "Confirm save"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preset button ─────────────────────────────────────────────────────
//
// Click → apply preset to in-flight selection. The first click confirms;
// subsequent clicks within 4s apply without re-asking (double-click intent
// pattern). Prevents accidental destruction of careful permission tuning
// while not creating confirmation fatigue for power users.
function PresetButton({
  preset,
  onApply,
}: {
  preset: PermissionPreset;
  onApply: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <button
      type="button"
      onClick={() => {
        if (confirming) {
          onApply();
          setConfirming(false);
        } else {
          setConfirming(true);
        }
      }}
      title={preset.description}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        confirming
          ? "border-amber-400 bg-amber-50 text-amber-900"
          : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Sparkles className="h-3 w-3" />
      {confirming ? "Click again to confirm" : preset.label}
    </button>
  );
}

// ── Clone role dialog ─────────────────────────────────────────────────
function CloneRoleDialog({
  open,
  source,
  onClose,
  onCloned,
}: {
  open: boolean;
  source: Role | null;
  onClose: () => void;
  onCloned: (newRoleId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && source) {
      setName(`Copy of ${source.name}`);
      setDescription(source.description ?? "");
    }
  }, [open, source]);

  if (!open || !source) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const created = await apiPost<{ id: string }>(
        `/api/roles/${source.id}/clone`,
        { name: name.trim(), description: description.trim() || null },
      );
      toast.success(`Role "${name}" created from "${source.name}"`);
      onCloned(created.id);
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to clone role"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Copy className="h-4 w-4" />
            Clone role
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <form onSubmit={handleSubmit} className="space-y-3 px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Cloning <span className="font-medium">{source.name}</span>
            {source.isSystem && " (system role)"}. The clone inherits all
            permissions and is created as a custom role you can edit
            freely.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <footer className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Cloning…" : "Clone role"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

// ── Audit history dialog ──────────────────────────────────────────────
//
// Shows a chronological list of audit_log entries scoped to one role.
// Includes both Role (CREATE/UPDATE/DELETE) and RolePermission (UPDATE)
// resource types — they're both "what happened to this role". For
// permission changes the diff is reconstructed from oldValues/newValues
// JSON on the client.
function AuditHistoryDialog({
  open,
  role,
  onClose,
}: {
  open: boolean;
  role: Role | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<AuditHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    if (!open || !role) return;
    setLoading(true);
    apiGet<AuditHistoryResponse>(
      `/api/roles/${role.id}/history?limit=${limit}&offset=${page * limit}`,
    )
      .then(setData)
      .catch((e) => toast.error(getApiErrorMessage(e, "Failed to load history")))
      .finally(() => setLoading(false));
  }, [open, role, page]);

  // Reset to page 0 whenever the dialog opens for a different role.
  useEffect(() => {
    setPage(0);
    setData(null);
  }, [role?.id]);

  if (!open || !role) return null;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border bg-card shadow-lg">
        <header className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <History className="h-4 w-4" />
            History · {role.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && !data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : !data || data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audit entries for this role yet.
            </p>
          ) : (
            <ul className="divide-y rounded-md border bg-background">
              {data.rows.map((entry) => (
                <li key={entry.id} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        entry.action === "CREATE" &&
                          "bg-green-100 text-green-800",
                        entry.action === "UPDATE" &&
                          "bg-blue-100 text-blue-800",
                        entry.action === "DELETE" &&
                          "bg-red-100 text-red-800",
                      )}
                    >
                      {entry.action}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entry.resourceType}
                    </span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    by{" "}
                    <span className="font-medium text-foreground">
                      {entry.user?.name ?? "Deleted user"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data && data.total > limit && (
          <footer className="flex items-center justify-between border-t px-5 py-2 text-xs text-muted-foreground">
            <span>
              Page {page + 1} of {totalPages} · {data.total} total
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1 || loading}
                className="rounded border px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}

// ── Section badge ─────────────────────────────────────────────────────
//
// Variant ramps with how much of the section is enabled:
//   - 0 / total  → outline (grey)
//   - partial    → secondary (muted blue)
//   - all enabled → solid primary
function SectionBadge({ enabled, total }: { enabled: number; total: number }) {
  const variant =
    enabled === 0
      ? "bg-transparent text-muted-foreground border"
      : enabled === total
        ? "bg-primary/15 text-primary border-primary/30 border"
        : "bg-secondary text-secondary-foreground border border-transparent";
  return (
    <span
      className={cn(
        "ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
        variant,
      )}
      title={`${enabled} of ${total} permissions enabled`}
    >
      {enabled}/{total}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
function RolesContent() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<Role | null>(null);
  const [historyRole, setHistoryRole] = useState<Role | null>(null);
  // Compare multi-select. Limited to 2 IDs at a time — comparison is
  // pairwise. UI gates further additions when 2 are already selected.
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 2) next.add(id);
      return next;
    });
  };

  const launchCompare = () => {
    const ids = Array.from(compareIds);
    if (ids.length !== 2) return;
    router.push(`/admin/roles/compare?a=${ids[0]}&b=${ids[1]}`);
  };

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Role[]>("/api/roles");
      setRoles(data);
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Failed to load roles"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const handleDelete = async (role: Role) => {
    if (
      !confirm(
        `Delete role "${role.name}"? This cannot be undone. The role can only be deleted if no users are assigned to it.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/roles/${role.id}`);
      toast.success(`Role "${role.name}" deleted`);
      void fetchRoles();
    } catch (e) {
      toast.error(getApiErrorMessage(e, "Failed to delete role"));
    }
  };

  return (
    <div className="p-6" data-tour="role-management">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Roles &amp; Permissions
        </h1>
        <div className="flex items-center gap-2">
          {/* Compare CTA — only visible when ≥1 selected; live count.
              Disabled until exactly 2 are checked (pairwise diff only). */}
          {compareIds.size > 0 && (
            <button
              type="button"
              onClick={launchCompare}
              disabled={compareIds.size !== 2}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium",
                compareIds.size === 2
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "text-muted-foreground",
              )}
              title={
                compareIds.size === 2
                  ? "Compare the 2 selected roles"
                  : `Select ${2 - compareIds.size} more role to compare`
              }
            >
              <GitCompare className="h-3.5 w-3.5" />
              Compare ({compareIds.size}/2)
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-tour="add-role-btn"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add Role
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-10 px-2 py-3"></th>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Description</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-right font-medium">Users</th>
              <th className="px-4 py-3 text-right font-medium">Permissions</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading roles…
                </td>
              </tr>
            ) : roles.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No roles found.
                </td>
              </tr>
            ) : (
              roles.map((role) => {
                const isCompareSelected = compareIds.has(role.id);
                // Disable checkbox when 2 already selected and this is
                // not one of them — pairwise diff cap.
                const compareDisabled =
                  !isCompareSelected && compareIds.size >= 2;
                return (
                  <tr
                    key={role.id}
                    className={cn(
                      "border-b last:border-b-0",
                      isCompareSelected && "bg-primary/5",
                    )}
                  >
                    <td className="px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={isCompareSelected}
                        disabled={compareDisabled}
                        onChange={() => toggleCompare(role.id)}
                        aria-label={`Select ${role.name} for comparison`}
                        title={
                          compareDisabled
                            ? "Only 2 roles can be compared at a time"
                            : "Select for comparison"
                        }
                        className="h-3.5 w-3.5 rounded border disabled:opacity-30"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{role.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {role.description || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          role.isSystem
                            ? "bg-blue-100 text-blue-800"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {role.isSystem ? "System" : "Custom"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {role.userCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {role.permissionCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* System roles: read-only permissions view (backend
                          blocks edits anyway). System roles can be cloned
                          (research: "Block deletion of system roles; allow
                          cloning freely"). Delete hidden because system
                          rows are protected. */}
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setSelectedRole(role)}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                          title={
                            role.isSystem
                              ? "View permissions (read-only)"
                              : "Edit permissions"
                          }
                        >
                          {role.isSystem ? "View" : "Permissions"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCloneSource(role)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Clone this role as a new custom role"
                        >
                          <Copy className="h-3 w-3" />
                          Clone
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryRole(role)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Audit history"
                        >
                          <Clock className="h-3 w-3" />
                          History
                        </button>
                        {!role.isSystem && (
                          <button
                            type="button"
                            onClick={() => void handleDelete(role)}
                            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedRole && (
        <PermissionEditor
          role={selectedRole}
          onClose={() => {
            setSelectedRole(null);
            void fetchRoles();
          }}
        />
      )}

      <RoleCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void fetchRoles()}
      />

      <CloneRoleDialog
        open={!!cloneSource}
        source={cloneSource}
        onClose={() => setCloneSource(null)}
        onCloned={(newRoleId) => {
          void fetchRoles();
          // Per research recommendation: after cloning, immediately
          // open the permission editor on the new role so the admin
          // can customise. Find it in the list once fetchRoles
          // resolves; meanwhile open by id stub.
          setSelectedRole({
            id: newRoleId,
            name: cloneSource ? `Copy of ${cloneSource.name}` : "New role",
            description: cloneSource?.description ?? null,
            isSystem: false,
            userCount: 0,
            permissionCount: cloneSource?.permissionCount ?? 0,
          });
        }}
      />

      <AuditHistoryDialog
        open={!!historyRole}
        role={historyRole}
        onClose={() => setHistoryRole(null)}
      />
    </div>
  );
}

export default function RolesPage() {
  return (
    <ProtectedRoute permission="roles:manage">
      <RolesContent />
    </ProtectedRoute>
  );
}
