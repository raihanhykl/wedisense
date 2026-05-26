"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared breadcrumb — replaces the ad-hoc "Back" links scattered across
// admin pages. Pattern:
//
//   <Breadcrumb items={[
//     { label: "Assets", href: "/admin/assets" },
//     { label: asset.name },          // last item: no href, current page
//   ]} />
//
// Each non-leaf item renders as a Next Link (instant client nav). The
// leaf item is plain text in the foreground color so the user always
// sees where they are. A small Home icon at the start links back to
// /admin (the dashboard) for one-click escape from any nested view.
//
// Visual rules:
//   - Trailing crumb is the current page — never linked, foreground text
//   - Separator: ChevronRight, muted
//   - Wraps responsively; long crumbs truncate with ellipsis at md-
//   - Aria-label "Breadcrumb" + ol > li semantics for screen readers

export interface BreadcrumbItem {
  /** Visible text for this crumb. Required. */
  label: string;
  /** Target route. Omit for the last (current) crumb. */
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** Hide the leading Home icon link to /admin. Default: show. */
  hideHome?: boolean;
  className?: string;
}

export default function Breadcrumb({
  items,
  hideHome = false,
  className,
}: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-4", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {!hideHome && (
          <li className="flex items-center">
            <Link
              href="/admin"
              className="flex items-center rounded p-1 hover:bg-muted hover:text-foreground"
              aria-label="Admin home"
            >
              <Home className="h-3.5 w-3.5" />
            </Link>
          </li>
        )}
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center">
              {(!hideHome || idx > 0) && (
                <ChevronRight
                  className="mx-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              )}
              {isLast || !item.href ? (
                <span
                  className="max-w-[16rem] truncate font-medium text-foreground"
                  aria-current={isLast ? "page" : undefined}
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="max-w-[16rem] truncate rounded px-1 hover:bg-muted hover:text-foreground"
                  title={item.label}
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
