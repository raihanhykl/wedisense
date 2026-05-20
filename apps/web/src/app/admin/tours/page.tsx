"use client";

/**
 * /admin/tours — Tour management list page.
 * Shows one row per role's tour. SUPER_ADMIN / any user with tours:manage.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import type { TourDto } from "@/types/admin";
import type { Role } from "@/types/admin";

// ── Create Tour Dialog ─────────────────────────────────────────────────────────

interface CreateTourDialogProps {
  open: boolean;
  roles: Role[];
  existingRoleIds: Set<string>;
  onClose: () => void;
  onCreated: (tourId: string) => void;
}

function CreateTourDialog({
  open,
  roles,
  existingRoleIds,
  onClose,
  onCreated,
}: CreateTourDialogProps) {
  const [roleId, setRoleId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    const firstAvailable = roles.find((r) => !existingRoleIds.has(r.id));
    setRoleId(firstAvailable?.id ?? "");
  }, [open, roles, existingRoleIds]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const availableRoles = roles.filter((r) => !existingRoleIds.has(r.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleId || !name.trim()) return;
    setSubmitting(true);
    try {
      const tour = await apiPost<TourDto>("/api/tours", {
        roleId,
        name: name.trim(),
        description: description.trim() || null,
        isActive: true,
        steps: [],
      });
      onCreated(tour.id);
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to create tour"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-tour-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="create-tour-title" className="mb-4 text-lg font-semibold">
          Create tour
        </h2>

        {availableRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All roles already have a tour. Edit an existing one instead.
          </p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ct-role">
                Role <span className="text-destructive">*</span>
              </label>
              <select
                id="ct-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="" disabled>
                  Select a role
                </option>
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ct-name">
                Tour name <span className="text-destructive">*</span>
              </label>
              <input
                id="ct-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Admin Onboarding"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="ct-desc">
                Description
              </label>
              <textarea
                id="ct-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !roleId || !name.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Create tour"}
              </button>
            </div>
          </form>
        )}

        {availableRoles.length === 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ToursAdminPage() {
  const router = useRouter();
  const canManage = usePermission("tours:manage");

  const [tours, setTours] = useState<TourDto[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [toursData, rolesData] = await Promise.all([
        apiGet<TourDto[]>("/api/tours"),
        apiGet<Role[]>("/api/roles"),
      ]);
      setTours(Array.isArray(toursData) ? toursData : []);
      setRoles(Array.isArray(rolesData) ? rolesData : []);
    } catch (err) {
      setPageError(getApiErrorMessage(err, "Failed to load tours"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleDelete = async (tour: TourDto) => {
    if (
      !window.confirm(
        `Delete tour "${tour.name}" (${tour.roleName})? This will remove all steps and cannot be undone.`,
      )
    )
      return;
    try {
      await apiDelete(`/api/tours/${tour.id}`);
      toast.success(`Tour "${tour.name}" deleted.`);
      await fetchData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Delete failed"));
    }
  };

  const handleSync = async (tour: TourDto) => {
    try {
      await apiPost(`/api/tours/${tour.id}/sync`);
      toast.success(`Tour-sync job queued for role ${tour.roleName}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Sync failed"));
    }
  };

  const existingRoleIds = new Set(tours.map((t) => t.roleId));

  if (!canManage) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          Insufficient permissions. You need{" "}
          <span className="font-mono">tours:manage</span> to access this page.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6" data-tour="role-management">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Onboarding Tours</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage role-based onboarding tours. One tour per role. Edit steps, reorder
            them, and trigger re-sync when permissions change.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateDialogOpen(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Create tour
        </button>
      </div>

      {pageError && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading tours...</p>
        ) : tours.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No tours yet. Click &quot;Create tour&quot; to create the first one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Tour name</th>
                <th className="px-4 py-3 font-medium text-center">Steps</th>
                <th className="px-4 py-3 font-medium text-center">Active</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => (
                <tr key={tour.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                      {tour.roleName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{tour.name}</span>
                    {tour.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {tour.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">
                    {tour.steps.length}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={
                        tour.isActive
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {tour.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/admin/tours/${tour.id}`}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleSync(tour)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        Re-sync
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(tour)}
                        className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateTourDialog
        open={createDialogOpen}
        roles={roles}
        existingRoleIds={existingRoleIds}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(id) => router.push(`/admin/tours/${id}`)}
      />
    </div>
  );
}
