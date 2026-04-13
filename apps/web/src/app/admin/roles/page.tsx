"use client";

import { useCallback, useEffect, useState } from "react";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGet, apiPut, apiPost, apiDelete } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Role, Permission } from "@/types/admin";

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
      onSuccess();
      onClose();
    } catch {
      // handle error
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
function PermissionEditor({
  role,
  onClose,
}: {
  role: Role;
  onClose: () => void;
}) {
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [perms, rolePerms] = await Promise.all([
          apiGet<Permission[]>("/api/permissions"),
          apiGet<Permission[]>(`/api/roles/${role.id}/permissions`),
        ]);
        setAllPermissions(perms);
        setSelectedIds(new Set(rolePerms.map((p) => p.id)));
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [role.id]);

  // Group permissions by resource
  const grouped = allPermissions.reduce<Record<string, Permission[]>>(
    (acc, perm) => {
      const existing = acc[perm.resource];
      if (existing) {
        existing.push(perm);
      } else {
        acc[perm.resource] = [perm];
      }
      return acc;
    },
    {},
  );

  const togglePermission = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPut(`/api/roles/${role.id}/permissions`, {
        permissionIds: Array.from(selectedIds),
      });
      onClose();
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Permissions for {role.name}
            {role.isSystem && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                System
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading permissions...
          </p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([resource, perms]) => (
                <div key={resource} className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-semibold capitalize">
                    {resource}
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {perms.map((perm) => (
                      <label
                        key={perm.id}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="h-4 w-4 rounded border"
                        />
                        <span className="text-sm">{perm.action}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
function RolesContent() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Role[]>("/api/roles");
      setRoles(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this role?")) return;
    try {
      await apiDelete(`/api/roles/${id}`);
      void fetchRoles();
    } catch {
      // handle error
    }
  };

  return (
    <div className="p-6" data-tour="role-management">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Roles &amp; Permissions
        </h1>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          data-tour="add-role-btn"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add Role
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Description</th>
              <th className="px-4 py-3 text-left font-medium">Type</th>
              <th className="px-4 py-3 text-left font-medium">Permissions</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading roles...
                </td>
              </tr>
            ) : roles.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No roles found.
                </td>
              </tr>
            ) : (
              roles.map((role) => (
                <tr key={role.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{role.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {role.description || "-"}
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
                  <td className="px-4 py-3 text-muted-foreground">
                    {role.permissionCount}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedRole(role)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Permissions
                    </button>
                    {!role.isSystem && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(role.id)}
                        className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))
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
