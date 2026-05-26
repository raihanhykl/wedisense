"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, GitCompare } from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import { apiGet } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { Permission, Role } from "@/types/admin";

/**
 * Role comparison page — full-page matrix per research recommendation
 * ("Modals lack scroll room and make diff scanning exhausting"). Two
 * roles selected via query params, all catalog permissions listed with
 * per-role grant indicators and a diff column.
 *
 * Reached from the role list's "Compare (2/2)" button after checking
 * exactly 2 roles. URL is shareable — admins can paste the link in
 * tickets/Slack.
 */

interface ComparisonRow {
  permission: Permission;
  aHas: boolean;
  bHas: boolean;
  diff: "+" | "-" | "=";
}

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

function RoleComparisonContent() {
  const params = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [aPerms, setAPerms] = useState<Set<string>>(new Set());
  const [bPerms, setBPerms] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showOnlyDiff, setShowOnlyDiff] = useState(false);

  useEffect(() => {
    if (!aId || !bId) return;
    setLoading(true);
    Promise.all([
      apiGet<Role[]>("/api/roles"),
      apiGet<Permission[]>("/api/permissions"),
      apiGet<Array<{ permission: Permission }>>(
        `/api/roles/${aId}/permissions`,
      ),
      apiGet<Array<{ permission: Permission }>>(
        `/api/roles/${bId}/permissions`,
      ),
    ])
      .then(([allRoles, allPerms, ap, bp]) => {
        setRoles(allRoles);
        setCatalog(allPerms);
        setAPerms(new Set(ap.map((rp) => rp.permission.id)));
        setBPerms(new Set(bp.map((rp) => rp.permission.id)));
      })
      .catch((e) => toast.error(getApiErrorMessage(e, "Failed to load comparison")))
      .finally(() => setLoading(false));
  }, [aId, bId]);

  const roleA = roles.find((r) => r.id === aId);
  const roleB = roles.find((r) => r.id === bId);

  // Build comparison rows grouped by resource. Each row shows whether
  // role A and role B each grant the permission, with a diff symbol:
  //   + = A grants but B doesn't
  //   - = B grants but A doesn't
  //   = = both grant OR neither grants (no diff)
  const grouped = useMemo(() => {
    const map: Record<string, ComparisonRow[]> = {};
    for (const p of catalog) {
      const aHas = aPerms.has(p.id);
      const bHas = bPerms.has(p.id);
      const diff: ComparisonRow["diff"] =
        aHas && !bHas ? "+" : !aHas && bHas ? "-" : "=";
      if (showOnlyDiff && diff === "=") continue;
      (map[p.resource] ??= []).push({ permission: p, aHas, bHas, diff });
    }
    return Object.entries(map)
      .map(([resource, items]) => ({
        resource,
        label: labelForResource(resource),
        items: items.sort((a, b) =>
          a.permission.action.localeCompare(b.permission.action),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog, aPerms, bPerms, showOnlyDiff]);

  // Quick summary counts for the header — surfaces "X more permissions
  // in A than B" at a glance without scanning.
  const summary = useMemo(() => {
    let onlyA = 0;
    let onlyB = 0;
    let both = 0;
    for (const p of catalog) {
      const aHas = aPerms.has(p.id);
      const bHas = bPerms.has(p.id);
      if (aHas && bHas) both++;
      else if (aHas) onlyA++;
      else if (bHas) onlyB++;
    }
    return { onlyA, onlyB, both };
  }, [catalog, aPerms, bPerms]);

  if (!aId || !bId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Missing role IDs. Select two roles from the list and click Compare.
        </p>
        <Link
          href="/admin/roles"
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to roles
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <Link
        href="/admin/roles"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to roles
      </Link>

      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GitCompare className="h-5 w-5" />
          Role comparison
        </h1>
        {!loading && roleA && roleB && (
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{roleA.name}</span>{" "}
            vs{" "}
            <span className="font-medium text-foreground">{roleB.name}</span>
            {" · "}
            {summary.onlyA} only in {roleA.name}, {summary.onlyB} only in{" "}
            {roleB.name}, {summary.both} shared
          </p>
        )}
      </header>

      <div className="mb-3 flex items-center gap-3 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={showOnlyDiff}
            onChange={(e) => setShowOnlyDiff(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Show only differences
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Resource</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-center font-medium">
                  {roleA?.name ?? "—"}
                </th>
                <th className="px-3 py-2 text-center font-medium">
                  {roleB?.name ?? "—"}
                </th>
                <th className="px-3 py-2 text-center font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-xs text-muted-foreground"
                  >
                    No permissions to display (with current filter).
                  </td>
                </tr>
              ) : (
                grouped.map((g) =>
                  g.items.map((row, i) => (
                    <tr
                      key={row.permission.id}
                      className={cn(
                        "border-b last:border-b-0",
                        row.diff === "+" && "bg-green-50/50",
                        row.diff === "-" && "bg-red-50/50",
                      )}
                    >
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {i === 0 ? g.label : ""}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {row.permission.action}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {row.aHas ? (
                          <span className="text-green-700">✓</span>
                        ) : (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {row.bHas ? (
                          <span className="text-green-700">✓</span>
                        ) : (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs font-semibold">
                        {row.diff === "+" && (
                          <span className="text-green-700">+</span>
                        )}
                        {row.diff === "-" && (
                          <span className="text-red-700">−</span>
                        )}
                        {row.diff === "=" && (
                          <span className="text-muted-foreground/30">=</span>
                        )}
                      </td>
                    </tr>
                  )),
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function RoleComparePage() {
  return (
    <ProtectedRoute permission="roles:manage">
      <RoleComparisonContent />
    </ProtectedRoute>
  );
}
