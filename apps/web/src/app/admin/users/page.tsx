"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGet, apiDelete } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import UserFormDialog from "@/components/shared/user-form-dialog";
import ResetPasswordDialog from "@/components/shared/reset-password-dialog";
import type { UserListItem } from "@/types/admin";

function UsersContent() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  // Phase 17 v2 — admin-driven password reset. Gated to SUPER_ADMIN via
  // the dedicated `users:reset-password` permission (see seed.ts).
  const canResetPassword = usePermission("users:reset-password");
  const [resetPasswordUser, setResetPasswordUser] =
    useState<UserListItem | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<UserListItem[]>("/api/users");
      setUsers(data);
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  const handleEdit = (user: UserListItem) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await apiDelete(`/api/users/${id}`);
      void fetchUsers();
    } catch {
      // handle error
    }
  };

  const handleAdd = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  return (
    <div className="p-6" data-tour="user-management">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <button
          type="button"
          onClick={handleAdd}
          data-tour="add-user-btn"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add User
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="user-search"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Employee ID</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Roles</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.employeeId}
                  </td>
                  <td className="px-4 py-3">
                    {/* Backend stores Prisma enum literals in uppercase
                        (ACTIVE / INACTIVE / RESIGNED). The old lowercase
                        comparison here always missed every branch, so
                        every badge defaulted to red. Compare against
                        the actual enum values now. */}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        user.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : user.status === "INACTIVE"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800",
                      )}
                    >
                      {/* Render in title case for display: ACTIVE → Active. */}
                      {user.status.charAt(0) +
                        user.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.userRoles?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {user.userRoles.map((ur) => (
                          <span
                            key={`${ur.role.id}-${ur.locationId ?? "global"}`}
                            className="inline-flex items-center gap-1 rounded-full border bg-secondary/60 px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                            title={
                              ur.location
                                ? `${ur.role.name} scoped to ${ur.location.name}`
                                : `${ur.role.name} (all locations)`
                            }
                          >
                            <span>{ur.role.name}</span>
                            {ur.location ? (
                              <span className="text-[10px] font-normal text-muted-foreground">
                                @ {ur.location.name}
                              </span>
                            ) : (
                              <span className="text-[10px] font-normal text-muted-foreground">
                                · global
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No roles
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleEdit(user)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Edit
                    </button>
                    {canResetPassword && (
                      <button
                        type="button"
                        onClick={() => setResetPasswordUser(user)}
                        title="Override this user's password (SUPER_ADMIN only)"
                        className="ml-1 rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        Reset password
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(user.id)}
                      className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <UserFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void fetchUsers()}
        editingUser={editingUser}
      />

      <ResetPasswordDialog
        open={resetPasswordUser !== null}
        user={
          resetPasswordUser
            ? {
                id: resetPasswordUser.id,
                name: resetPasswordUser.name,
                email: resetPasswordUser.email,
              }
            : null
        }
        onClose={() => setResetPasswordUser(null)}
      />
    </div>
  );
}

export default function UsersPage() {
  return (
    <ProtectedRoute permission="users:manage">
      <UsersContent />
    </ProtectedRoute>
  );
}
