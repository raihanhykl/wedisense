"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, UserPlus, Users as UsersIcon } from "lucide-react";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGetPaginated, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import { toast } from "sonner";
import UserFormDialog from "@/components/shared/user-form-dialog";
import BulkEmployeeDialog from "@/components/shared/bulk-employee-dialog";
import ResetPasswordDialog from "@/components/shared/reset-password-dialog";
import type { UserListItem } from "@/types/admin";

// Account filter — "Employees" are records that never sign in.
const ACCOUNT_FILTERS = [
  { key: "all", label: "All" },
  { key: "account", label: "With login" },
  { key: "employee", label: "Employees only" },
] as const;
type AccountFilter = (typeof ACCOUNT_FILTERS)[number]["key"];

function UsersContent() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  // "Grant login" opens the edit dialog with the account checkbox pre-ticked.
  const [grantAccountOnOpen, setGrantAccountOnOpen] = useState(false);
  // Phase 17 v2 — admin-driven password reset. Gated to SUPER_ADMIN via
  // the dedicated `users:reset-password` permission (see seed.ts).
  const canResetPassword = usePermission("users:reset-password");
  const [resetPasswordUser, setResetPasswordUser] =
    useState<UserListItem | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // The directory now holds every employee, not just logins, so page
      // through the API's max page size instead of relying on the default
      // 20-row first page.
      const all: UserListItem[] = [];
      let page = 1;
      for (;;) {
        const result = await apiGetPaginated<UserListItem[]>("/api/users", {
          page,
          limit: 100,
        });
        all.push(...result.data);
        if (page >= result.meta.totalPages) break;
        page += 1;
      }
      setUsers(all);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (accountFilter === "account" && !u.hasAccount) return false;
      if (accountFilter === "employee" && u.hasAccount) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        u.employeeId.toLowerCase().includes(q)
      );
    });
  }, [users, search, accountFilter]);

  const counts = useMemo(
    () => ({
      total: users.length,
      withAccount: users.filter((u) => u.hasAccount).length,
    }),
    [users],
  );

  const handleEdit = (user: UserListItem, grantAccount = false) => {
    setEditingUser(user);
    setGrantAccountOnOpen(grantAccount);
    setDialogOpen(true);
  };

  const handleDelete = async (user: UserListItem) => {
    if (!confirm(`Delete ${user.name}? Their asset history is kept, but they can no longer be assigned assets.`)) {
      return;
    }
    try {
      await apiDelete(`/api/users/${user.id}`);
      toast.success(`Deleted ${user.name}`);
      void fetchUsers();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to delete user"));
    }
  };

  const handleAdd = () => {
    setEditingUser(null);
    setGrantAccountOnOpen(false);
    setDialogOpen(true);
  };

  return (
    <div className="p-6" data-tour="user-management">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users &amp; Employees</h1>
          <p className="text-xs text-muted-foreground">
            {counts.total} employee(s) · {counts.withAccount} with login
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            data-tour="add-employees-bulk-btn"
            className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            <UsersIcon className="h-4 w-4" /> Add employees (bulk)
          </button>
          <button
            type="button"
            onClick={handleAdd}
            data-tour="add-user-btn"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" /> Add Employee
          </button>
        </div>
      </div>

      {/* Search + account filter */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, email or employee ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm"
          data-tour="user-search"
        />
        <div className="inline-flex rounded-md border p-0.5" role="tablist">
          {ACCOUNT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={accountFilter === f.key}
              onClick={() => setAccountFilter(f.key)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium",
                accountFilter === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">Employee ID</th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Login</th>
              <th className="px-4 py-3 text-left font-medium">Roles</th>
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
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">
                    {user.name}
                    {user.phone && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {user.phone}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {user.employeeId}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {user.email ?? <span className="text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {/* Backend stores Prisma enum literals in uppercase
                        (ACTIVE / INACTIVE / RESIGNED). Compare against
                        the actual enum values. */}
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
                    {user.hasAccount ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        <KeyRound className="h-3 w-3" /> Has login
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        Employee only
                      </span>
                    )}
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
                        {user.hasAccount ? "No roles" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleEdit(user)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Edit
                    </button>
                    {!user.hasAccount && (
                      <button
                        type="button"
                        onClick={() => handleEdit(user, true)}
                        title="Create a login account for this employee"
                        className="ml-1 rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                      >
                        Grant login
                      </button>
                    )}
                    {canResetPassword && user.hasAccount && (
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
                      onClick={() => void handleDelete(user)}
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
        initialCreateAccount={grantAccountOnOpen}
      />

      <BulkEmployeeDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSuccess={() => void fetchUsers()}
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
