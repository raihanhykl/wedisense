"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AuditAction, AuditLogFilters } from "@/types/admin";

const AUDIT_ACTIONS: AuditAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "EXPORT",
  "IMPORT",
  "PRINT",
  "APPROVE",
  "REJECT",
];

const KNOWN_RESOURCE_TYPES = [
  "Asset",
  "User",
  "Role",
  "OnboardingTour",
  "AssetCategory",
  "AssetMovement",
  "Report",
  "MaintenanceSchedule",
  "LabelTemplate",
  "UserTourProgress",
  "UserSavedView",
];

export interface AuditFilterBarProps {
  filters: AuditLogFilters;
  onChange: (filters: AuditLogFilters) => void;
  onClear: () => void;
}

function hasActiveFilters(f: AuditLogFilters): boolean {
  return !!(
    f.search ||
    f.action ||
    f.resourceType ||
    f.resourceTypeCustom ||
    f.userId ||
    f.dateFrom ||
    f.dateTo
  );
}

export default function AuditFilterBar({
  filters,
  onChange,
  onClear,
}: AuditFilterBarProps) {
  // Debounced text fields — we hold a local copy and flush after 300 ms so
  // each keystroke doesn't trigger a network request.
  const [localSearch, setLocalSearch] = useState(filters.search);
  const [localUserId, setLocalUserId] = useState(filters.userId);
  const [localResourceTypeCustom, setLocalResourceTypeCustom] = useState(
    filters.resourceTypeCustom,
  );

  // Keep local state in sync if parent resets filters (e.g. "Clear" click).
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    const prev = prevFiltersRef.current;
    if (
      prev.search !== filters.search ||
      prev.userId !== filters.userId ||
      prev.resourceTypeCustom !== filters.resourceTypeCustom
    ) {
      setLocalSearch(filters.search);
      setLocalUserId(filters.userId);
      setLocalResourceTypeCustom(filters.resourceTypeCustom);
    }
    prevFiltersRef.current = filters;
  }, [filters]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customTypeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function debounce(
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    fn: () => void,
    delay = 300,
  ) {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, delay);
  }

  const handleSearch = (v: string) => {
    setLocalSearch(v);
    debounce(searchTimerRef, () => onChange({ ...filters, search: v }));
  };

  const handleUserId = (v: string) => {
    setLocalUserId(v);
    debounce(userIdTimerRef, () => onChange({ ...filters, userId: v }));
  };

  const handleResourceTypeCustom = (v: string) => {
    setLocalResourceTypeCustom(v);
    debounce(customTypeTimerRef, () =>
      onChange({ ...filters, resourceTypeCustom: v }),
    );
  };

  const handleAction = (v: string) => {
    onChange({ ...filters, action: v });
  };

  const handleResourceType = (v: string) => {
    // When switching away from "Other", clear the custom value.
    onChange({
      ...filters,
      resourceType: v,
      resourceTypeCustom: v === "__other__" ? filters.resourceTypeCustom : "",
    });
  };

  const isOther = filters.resourceType === "__other__";
  const active = hasActiveFilters(filters);

  return (
    <div
      className="border-b bg-card"
      data-tour="audit-filter-bar"
    >
      {/* Mobile accordion */}
      <details className="md:hidden">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <span>Filters</span>
          {active && (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              !
            </span>
          )}
        </summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <FilterFields
            localSearch={localSearch}
            localUserId={localUserId}
            localResourceTypeCustom={localResourceTypeCustom}
            filters={filters}
            isOther={isOther}
            active={active}
            onSearch={handleSearch}
            onUserId={handleUserId}
            onResourceTypeCustom={handleResourceTypeCustom}
            onAction={handleAction}
            onResourceType={handleResourceType}
            onClear={onClear}
            onDateFrom={(v) => onChange({ ...filters, dateFrom: v })}
            onDateTo={(v) => onChange({ ...filters, dateTo: v })}
          />
        </div>
      </details>

      {/* Desktop horizontal bar */}
      <div className="hidden md:flex md:flex-wrap md:items-end md:gap-3 md:px-6 md:py-3">
        <FilterFields
          localSearch={localSearch}
          localUserId={localUserId}
          localResourceTypeCustom={localResourceTypeCustom}
          filters={filters}
          isOther={isOther}
          active={active}
          onSearch={handleSearch}
          onUserId={handleUserId}
          onResourceTypeCustom={handleResourceTypeCustom}
          onAction={handleAction}
          onResourceType={handleResourceType}
          onClear={onClear}
          onDateFrom={(v) => onChange({ ...filters, dateFrom: v })}
          onDateTo={(v) => onChange({ ...filters, dateTo: v })}
        />
      </div>
    </div>
  );
}

// ── Internal sub-component so we can render the same fields in both
//    mobile accordion and desktop flex bar without duplication.
interface FilterFieldsProps {
  localSearch: string;
  localUserId: string;
  localResourceTypeCustom: string;
  filters: AuditLogFilters;
  isOther: boolean;
  active: boolean;
  onSearch: (v: string) => void;
  onUserId: (v: string) => void;
  onResourceTypeCustom: (v: string) => void;
  onAction: (v: string) => void;
  onResourceType: (v: string) => void;
  onClear: () => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
}

function FilterFields({
  localSearch,
  localUserId,
  localResourceTypeCustom,
  filters,
  isOther,
  active,
  onSearch,
  onUserId,
  onResourceTypeCustom,
  onAction,
  onResourceType,
  onClear,
  onDateFrom,
  onDateTo,
}: FilterFieldsProps) {
  return (
    <>
      {/* Search */}
      <div className="flex min-w-[220px] flex-1 flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Search
        </label>
        <input
          type="text"
          value={localSearch}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Resource ID, IP, or user agent…"
          className="rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-search-input"
        />
      </div>

      {/* Action */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Action
        </label>
        <select
          value={filters.action}
          onChange={(e) => onAction(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-action-filter"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Resource type */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Resource type
        </label>
        <select
          value={filters.resourceType}
          onChange={(e) => onResourceType(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-resource-type-filter"
        >
          <option value="">All resource types</option>
          {KNOWN_RESOURCE_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {rt}
            </option>
          ))}
          <option value="__other__">Other (type below)</option>
        </select>
        {isOther && (
          <input
            type="text"
            value={localResourceTypeCustom}
            onChange={(e) => onResourceTypeCustom(e.target.value)}
            placeholder="Type resource type…"
            className="mt-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}
      </div>

      {/* User ID */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          User ID (UUID)
          <span
            title="Copy a user ID from any audit log row or from the Users admin page."
            className="cursor-help text-muted-foreground underline decoration-dotted"
          >
            ?
          </span>
        </label>
        <input
          type="text"
          value={localUserId}
          onChange={(e) => onUserId(e.target.value)}
          placeholder="Paste a user UUID…"
          className="w-56 rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-user-filter"
        />
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          From
        </label>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onDateFrom(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-date-from"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          To
        </label>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onDateTo(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          data-tour="audit-date-to"
        />
      </div>

      {/* Clear */}
      <div className="flex flex-col justify-end">
        <button
          type="button"
          onClick={onClear}
          disabled={!active}
          className={cn(
            "rounded-md px-3 py-2 text-sm transition-colors",
            active
              ? "text-muted-foreground hover:bg-accent hover:text-foreground"
              : "cursor-not-allowed text-muted-foreground/40",
          )}
        >
          Clear filters
        </button>
      </div>
    </>
  );
}
