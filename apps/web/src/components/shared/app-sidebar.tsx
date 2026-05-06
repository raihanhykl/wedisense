"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth.store";
import { usePermission } from "@/hooks/use-permission";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  permission?: string;
}

const navItems: NavItem[] = [
  { label: "Scan", href: "/scan" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Assets", href: "/admin/assets" },
  { label: "Movements", href: "/admin/movements" },
  { label: "Maintenance", href: "/admin/maintenance" },
  { label: "Print", href: "/admin/print" },
  { label: "Notifications", href: "/admin/notifications" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Users", href: "/admin/users", permission: "users:manage" },
  { label: "Roles", href: "/admin/roles", permission: "roles:manage" },
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const hasPermission = usePermission(item.permission ?? "");
  const isActive = pathname === item.href;

  // If a permission is required and the user doesn't have it, hide the link
  if (item.permission && !hasPermission) {
    return null;
  }

  return (
    <Link
      href={item.href}
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

export default function AppSidebar() {
  const router = useRouter();
  const userName = useAuthStore((s) => s.user?.name ?? "");
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    router.push("/auth/login");
  };

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-card">
      {/* Brand */}
      <div className="border-b px-4 py-4">
        <h2 className="text-lg font-bold tracking-tight">Wedisense</h2>
        <p className="text-xs text-muted-foreground">Asset Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" data-tour="sidebar-nav">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {/* User section */}
      <div className="border-t px-4 py-3">
        <p className="truncate text-sm font-medium">{userName}</p>
        <button
          onClick={handleLogout}
          className="mt-1 text-xs text-muted-foreground hover:text-destructive"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
