"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission } from "@/hooks/use-permission";
import { cn } from "@/lib/utils";
import { TOURS_ENABLED } from "@/lib/feature-flags";

interface NavItem {
  label: string;
  href: string;
  permission?: string;
  /** Optional build-time gate. When falsy, the item is filtered before
   *  render. Used to hide entry-points for dormant features without
   *  ripping their code out. */
  enabled?: boolean;
}

const navItems: NavItem[] = [
  { label: "Scan", href: "/scan" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Assets", href: "/admin/assets" },
  // Phase 17 v2 — Procurement section. Standalone Procurement page
  // removed per spec §4: direct purchase routes through /assets/new,
  // procurement batches now live nested under each Purchase Order.
  {
    label: "Vendors",
    href: "/admin/vendors",
    permission: "vendors:read",
  },
  {
    label: "Purchase Orders",
    href: "/admin/purchase-orders",
    permission: "purchase-orders:read",
  },
  { label: "Movements", href: "/admin/movements" },
  { label: "Maintenance", href: "/admin/maintenance" },
  { label: "Print", href: "/admin/print" },
  { label: "Reports", href: "/admin/reports", permission: "reports:view" },
  { label: "Notifications", href: "/admin/notifications" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Categories", href: "/admin/asset-categories", permission: "categories:manage" },
  { label: "Tours", href: "/admin/tours", permission: "tours:manage", enabled: TOURS_ENABLED },
  { label: "Users", href: "/admin/users", permission: "users:manage" },
  { label: "Roles", href: "/admin/roles", permission: "roles:manage" },
  { label: "Audit", href: "/admin/audit", permission: "audit:read" },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const hasPermission = usePermission(item.permission ?? "");
  const isActive = pathname === item.href;

  // Build-time gate (dormant features) — checked before permissions so
  // a dormant link doesn't even appear for users who would otherwise be
  // entitled to it.
  if (item.enabled === false) {
    return null;
  }

  // If a permission is required and the user doesn't have it, hide the link
  if (item.permission && !hasPermission) {
    return null;
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {item.label}
    </Link>
  );
}

interface AppSidebarProps {
  /** Whether the mobile drawer is open. Ignored ≥md (always visible). */
  open: boolean;
  /** Fired when the drawer should close (route change, backdrop click, X). */
  onClose: () => void;
}

export default function AppSidebar({ open, onClose }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const userName = useAuthStore((s) => s.user?.name ?? "");
  const logout = useAuthStore((s) => s.logout);

  // Auto-close on route change. Without this the drawer stays open after a
  // nav-link click on mobile, leaving the user staring at the menu when they
  // want to see the new page.
  useEffect(() => {
    onClose();
    // We intentionally don't depend on `onClose` — parent passes a fresh
    // function each render which would re-fire this effect spuriously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open so background content
  // doesn't slide under the user's thumb. No-op on md+ where the sidebar
  // is part of the static layout.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Esc to close while drawer is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleLogout = () => {
    logout();
    router.push("/auth/login");
  };

  return (
    <>
      {/* Backdrop — mobile only. Click anywhere outside the drawer to close. */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-30 bg-black/50 transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left. The transform
          // approach keeps the DOM stable (better for screen readers than
          // toggling display).
          "fixed inset-y-0 left-0 z-40 flex h-screen w-60 flex-col border-r bg-card transition-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // ≥md: become part of the static layout — no fixed positioning,
          // always visible.
          "md:static md:translate-x-0",
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b px-4 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Wedisense</h2>
            <p className="text-xs text-muted-foreground">Asset Management</p>
          </div>
          {/* Close button — mobile only. Easier thumb target than the
              backdrop tap, and avoids accidentally tapping a nav link below. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" data-tour="sidebar-nav">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} onNavigate={onClose} />
          ))}
        </nav>

        {/* User section */}
        <div className="border-t px-4 py-3">
          <Link
            href="/admin/profile"
            onClick={onClose}
            className="block truncate text-sm font-medium hover:text-primary"
          >
            {userName}
          </Link>
          <button
            onClick={handleLogout}
            className="mt-1 text-xs text-muted-foreground hover:text-destructive"
          >
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
