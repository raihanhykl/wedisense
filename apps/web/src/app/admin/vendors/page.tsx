"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import VendorFormDialog from "@/components/shared/vendor-form-dialog";
import { apiDelete, apiGetPaginated } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import { cn } from "@/lib/utils";
import type { VendorListItem } from "@/types/admin";
import type { PaginationMeta } from "@/lib/api";

function VendorsContent() {
  const canCreate = usePermission("vendors:create");
  const canUpdate = usePermission("vendors:update");
  const canDelete = usePermission("vendors:delete");

  // Search state pair — `searchInput` mirrors the keystrokes, `search`
  // is the debounced value that drives the actual fetch. Matches the
  // pattern used in the asset list page.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");

  const [vendors, setVendors] = useState<VendorListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorListItem | null>(
    null,
  );

  // ── Debounce keystrokes → committed search ───────────────────────
  useEffect(() => {
    if (searchInput === search) return;
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1); // new search → start at page 1
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, limit: 20 };
      if (search.trim()) params.search = search.trim();
      if (activeFilter) params.isActive = activeFilter;
      const result = await apiGetPaginated<VendorListItem[]>(
        "/api/vendors",
        params,
      );
      setVendors(result.data);
      setMeta(result.meta);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load vendors"));
    } finally {
      setLoading(false);
    }
  }, [page, search, activeFilter]);

  useEffect(() => {
    void fetchVendors();
  }, [fetchVendors]);

  const handleAdd = () => {
    setEditingVendor(null);
    setDialogOpen(true);
  };

  const handleEdit = (vendor: VendorListItem) => {
    setEditingVendor(vendor);
    setDialogOpen(true);
  };

  const handleDelete = async (vendor: VendorListItem) => {
    if (vendor._count.purchaseOrders > 0) {
      toast.error(
        `Cannot delete "${vendor.name}" — ${vendor._count.purchaseOrders} purchase order(s) reference this vendor.`,
      );
      return;
    }
    if (
      !confirm(
        `Delete vendor "${vendor.name}"? This is a soft-delete; the row will be hidden but historical references remain.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/vendors/${vendor.id}`);
      toast.success(`Vendor deleted: ${vendor.name}`);
      void fetchVendors();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to delete vendor"));
    }
  };

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Vendors" }]} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Suppliers referenced from purchase orders and assets. Inline
            quick-save from those forms creates name-only rows; full
            details (NPWP, contact, address) are filled in here.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={handleAdd}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add vendor
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search name, NPWP, email, contact…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={activeFilter}
          onChange={(e) => {
            setActiveFilter(e.target.value as "" | "true" | "false");
            setPage(1);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Name</th>
              <th className="px-4 py-3 text-left font-medium">NPWP</th>
              <th className="px-4 py-3 text-left font-medium">Contact</th>
              <th className="px-4 py-3 text-left font-medium">Phone</th>
              <th className="px-4 py-3 text-right font-medium">POs</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </td>
              </tr>
            ) : vendors.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {search.trim() || activeFilter
                    ? "No vendors match the current filters."
                    : "No vendors yet. Click Add vendor to create one."}
                </td>
              </tr>
            ) : (
              vendors.map((vendor) => (
                <tr key={vendor.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{vendor.name}</div>
                    {vendor.email && (
                      <div className="text-xs text-muted-foreground">
                        {vendor.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {vendor.taxId ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {vendor.contactPerson ?? "-"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {vendor.phone ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {vendor._count.purchaseOrders}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        vendor.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-700",
                      )}
                    >
                      {vendor.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canUpdate && (
                      <button
                        type="button"
                        onClick={() => handleEdit(vendor)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete(vendor)}
                        disabled={vendor._count.purchaseOrders > 0}
                        title={
                          vendor._count.purchaseOrders > 0
                            ? `Cannot delete — ${vendor._count.purchaseOrders} PO(s) reference this vendor`
                            : "Delete vendor"
                        }
                        className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        <Trash2 className="h-3 w-3" />
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

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {meta.page} of {meta.totalPages} ({meta.total} total)
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded-md border px-3 py-1 hover:bg-accent disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= meta.totalPages || loading}
              className="rounded-md border px-3 py-1 hover:bg-accent disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <VendorFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={() => void fetchVendors()}
        editingVendor={editingVendor}
      />
    </div>
  );
}

export default function VendorsPage() {
  return (
    <ProtectedRoute permission="vendors:read">
      <VendorsContent />
    </ProtectedRoute>
  );
}
