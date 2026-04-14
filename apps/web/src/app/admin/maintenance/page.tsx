"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGetPaginated, apiDelete } from "@/lib/api";
import type { PaginationMeta } from "@/lib/api";
import { cn } from "@/lib/utils";
import { usePermission } from "@/hooks/use-permission";
import type {
  MaintenanceScheduleItem,
  MaintenanceLogItem,
} from "@/types/admin";
import MaintenanceScheduleDialog from "@/components/shared/maintenance-schedule-dialog";
import MaintenanceLogDialog from "@/components/shared/maintenance-log-dialog";

// ── Badge helpers ───────────────────────────────────────────────────
const FREQUENCY_COLORS: Record<string, string> = {
  ONE_TIME: "bg-gray-100 text-gray-800",
  DAILY: "bg-blue-100 text-blue-800",
  WEEKLY: "bg-indigo-100 text-indigo-800",
  MONTHLY: "bg-purple-100 text-purple-800",
  QUARTERLY: "bg-orange-100 text-orange-800",
  YEARLY: "bg-green-100 text-green-800",
};

function FrequencyBadge({ type }: { type: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        FREQUENCY_COLORS[type] ?? "bg-gray-100 text-gray-800",
      )}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

const CONDITION_COLORS: Record<string, string> = {
  NEW: "text-blue-700",
  GOOD: "text-green-700",
  FAIR: "text-yellow-700",
  POOR: "text-orange-700",
  DAMAGED: "text-red-700",
};

// ── Date helpers ────────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOverdue(dateStr: string): boolean {
  const due = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

// ── Tab type ────────────────────────────────────────────────────────
type Tab = "schedules" | "logs";

// ── Page ────────────────────────────────────────────────────────────
export default function MaintenancePage() {
  const canManage = usePermission("maintenance:manage");
  const [activeTab, setActiveTab] = useState<Tab>("schedules");

  // ── Schedules state ─────────────────────────────────────────────
  const [schedules, setSchedules] = useState<MaintenanceScheduleItem[]>([]);
  const [schedulesMeta, setSchedulesMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [schedulesPage, setSchedulesPage] = useState(1);
  const [schedulesSearch, setSchedulesSearch] = useState("");

  // ── Logs state ──────────────────────────────────────────────────
  const [logs, setLogs] = useState<MaintenanceLogItem[]>([]);
  const [logsMeta, setLogsMeta] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsPage, setLogsPage] = useState(1);
  const [logsSearch, setLogsSearch] = useState("");

  // ── Dialog state ────────────────────────────────────────────────
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] =
    useState<MaintenanceScheduleItem | null>(null);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [prefillSchedule, setPrefillSchedule] =
    useState<MaintenanceScheduleItem | null>(null);

  // ── Fetch schedules ─────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: schedulesPage,
        limit: 10,
      };
      if (schedulesSearch.trim()) params.search = schedulesSearch.trim();

      const result = await apiGetPaginated<MaintenanceScheduleItem[]>(
        "/api/maintenance/schedules",
        params,
      );
      setSchedules(result.data);
      setSchedulesMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setSchedulesLoading(false);
    }
  }, [schedulesPage, schedulesSearch]);

  // ── Fetch logs ──────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params: Record<string, unknown> = {
        page: logsPage,
        limit: 10,
      };
      if (logsSearch.trim()) params.search = logsSearch.trim();

      const result = await apiGetPaginated<MaintenanceLogItem[]>(
        "/api/maintenance/logs",
        params,
      );
      setLogs(result.data);
      setLogsMeta(result.meta);
    } catch {
      // handle error silently
    } finally {
      setLogsLoading(false);
    }
  }, [logsPage, logsSearch]);

  useEffect(() => {
    if (activeTab === "schedules") {
      void fetchSchedules();
    } else {
      void fetchLogs();
    }
  }, [activeTab, fetchSchedules, fetchLogs]);

  // ── Handlers ────────────────────────────────────────────────────
  const handleDeleteSchedule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await apiDelete(`/api/maintenance/schedules/${id}`);
      void fetchSchedules();
    } catch {
      // handle error
    }
  };

  const handleEditSchedule = (schedule: MaintenanceScheduleItem) => {
    setEditingSchedule(schedule);
    setScheduleDialogOpen(true);
  };

  const handleLogMaintenance = (schedule: MaintenanceScheduleItem) => {
    setPrefillSchedule(schedule);
    setLogDialogOpen(true);
  };

  const handleSchedulesSearchChange = (value: string) => {
    setSchedulesSearch(value);
    setSchedulesPage(1);
  };

  const handleLogsSearchChange = (value: string) => {
    setLogsSearch(value);
    setLogsPage(1);
  };

  return (
    <div className="p-6" data-tour="maintenance">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Maintenance</h1>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setActiveTab("schedules")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "schedules"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Schedules
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "logs"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Logs
        </button>
      </div>

      {/* ── Schedules Tab ──────────────────────────────────────────── */}
      {activeTab === "schedules" && (
        <>
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search schedules..."
              value={schedulesSearch}
              onChange={(e) => handleSchedulesSearchChange(e.target.value)}
              className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
            />
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setEditingSchedule(null);
                  setScheduleDialogOpen(true);
                }}
                className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add Schedule
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Title</th>
                  <th className="px-4 py-3 text-left font-medium">Asset</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Frequency
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Next Due Date
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Last Done
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  {canManage && (
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {schedulesLoading ? (
                  <tr>
                    <td
                      colSpan={canManage ? 7 : 6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Loading schedules...
                    </td>
                  </tr>
                ) : schedules.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManage ? 7 : 6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No schedules found.
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const overdue =
                      schedule.isActive && isOverdue(schedule.nextDueDate);
                    return (
                      <tr
                        key={schedule.id}
                        className={cn(
                          "border-b last:border-b-0",
                          overdue && "bg-red-50",
                        )}
                      >
                        <td className="px-4 py-3 font-medium">
                          {schedule.title}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {schedule.asset.name}
                        </td>
                        <td className="px-4 py-3">
                          <FrequencyBadge type={schedule.frequencyType} />
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3",
                            overdue
                              ? "font-medium text-red-600"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatDate(schedule.nextDueDate)}
                          {overdue && (
                            <span className="ml-1 text-xs">(overdue)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {schedule.lastDoneDate
                            ? formatDate(schedule.lastDoneDate)
                            : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              schedule.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800",
                            )}
                          >
                            {schedule.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {canManage && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleLogMaintenance(schedule)}
                                className="rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
                              >
                                Log
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditSchedule(schedule)}
                                className="rounded px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleDeleteSchedule(schedule.id)
                                }
                                className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {schedulesMeta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing page {schedulesMeta.page} of{" "}
                {schedulesMeta.totalPages} ({schedulesMeta.total} total)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={schedulesPage <= 1}
                  onClick={() =>
                    setSchedulesPage((p) => Math.max(1, p - 1))
                  }
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={schedulesPage >= schedulesMeta.totalPages}
                  onClick={() => setSchedulesPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Logs Tab ───────────────────────────────────────────────── */}
      {activeTab === "logs" && (
        <>
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search logs..."
              value={logsSearch}
              onChange={(e) => handleLogsSearchChange(e.target.value)}
              className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
            />
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setPrefillSchedule(null);
                  setLogDialogOpen(true);
                }}
                className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add Log
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Asset</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    Condition
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Cost</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Performed By
                  </th>
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      Loading logs...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateTime(log.performedAt)}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {log.asset.name}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                        {log.description}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            CONDITION_COLORS[log.conditionBefore] ?? "",
                          )}
                        >
                          {log.conditionBefore}
                        </span>
                        <span className="mx-1 text-muted-foreground">
                          &rarr;
                        </span>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            CONDITION_COLORS[log.conditionAfter] ?? "",
                          )}
                        >
                          {log.conditionAfter}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {log.cost ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {log.performedBy.name}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {logsMeta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing page {logsMeta.page} of {logsMeta.totalPages} (
                {logsMeta.total} total)
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={logsPage <= 1}
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={logsPage >= logsMeta.totalPages}
                  onClick={() => setLogsPage((p) => p + 1)}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────── */}
      <MaintenanceScheduleDialog
        open={scheduleDialogOpen}
        onClose={() => {
          setScheduleDialogOpen(false);
          setEditingSchedule(null);
        }}
        onSaved={() => void fetchSchedules()}
        schedule={editingSchedule}
      />

      <MaintenanceLogDialog
        open={logDialogOpen}
        onClose={() => {
          setLogDialogOpen(false);
          setPrefillSchedule(null);
        }}
        onSaved={() => void fetchLogs()}
        prefillSchedule={prefillSchedule}
      />
    </div>
  );
}
