"use client";

/**
 * /admin/tours/[id] — Tour step editor.
 *
 * Maintains a local "draft" copy of the tour so dirty-state comparison is
 * reliable. The user can reorder, edit, and delete steps locally; all changes
 * are sent as a single PUT when they click "Save changes".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import TourStepList from "@/components/shared/tour-step-list";
import TourStepFormDialog from "@/components/shared/tour-step-form-dialog";
import type { TourDto, TourStepDto } from "@/types/admin";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** True when two step arrays are semantically equal. */
function stepsEqual(a: TourStepDto[], b: TourStepDto[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((stepA, i) => {
    const stepB = b[i];
    if (!stepB) return false;
    return (
      stepA.stepIndex === stepB.stepIndex &&
      stepA.title === stepB.title &&
      stepA.description === stepB.description &&
      stepA.targetElement === stepB.targetElement &&
      stepA.route === stepB.route &&
      stepA.position === stepB.position &&
      stepA.isActive === stepB.isActive &&
      JSON.stringify(stepA.requiredPermission) === JSON.stringify(stepB.requiredPermission)
    );
  });
}

function metaEqual(
  tour: TourDto,
  name: string,
  description: string,
  isActive: boolean,
): boolean {
  return (
    tour.name === name &&
    (tour.description ?? "") === description &&
    tour.isActive === isActive
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

interface PageProps {
  // Next 14 / React 18: params is a plain object. The async-params shape
  // (Promise wrapped) belongs to Next 15 / React 19 and breaks at runtime
  // here with `Error: An unsupported type was passed to use(): [object Object]`.
  params: { id: string };
}

export default function TourEditPage({ params }: PageProps) {
  const { id } = params;
  const canManage = usePermission("tours:manage");

  // Server state
  const [tour, setTour] = useState<TourDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Draft state (local copy the user edits before saving)
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftIsActive, setDraftIsActive] = useState(true);
  const [draftSteps, setDraftSteps] = useState<TourStepDto[]>([]);

  // Dialog state
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);

  // Derived dirty flag
  const isDirty =
    tour !== null &&
    (
      !metaEqual(tour, draftName, draftDescription, draftIsActive) ||
      !stepsEqual(tour.steps, draftSteps)
    );

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchTour = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const data = await apiGet<TourDto>(`/api/tours/${id}`);
      setTour(data);
      setDraftName(data.name);
      setDraftDescription(data.description ?? "");
      setDraftIsActive(data.isActive);
      setDraftSteps(data.steps);
    } catch (err) {
      setPageError(getApiErrorMessage(err, "Failed to load tour"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchTour();
  }, [fetchTour]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await apiPut<TourDto>(`/api/tours/${id}`, {
        name: draftName.trim(),
        description: draftDescription.trim() || null,
        isActive: draftIsActive,
        steps: draftSteps,
      });
      setTour(updated);
      setDraftName(updated.name);
      setDraftDescription(updated.description ?? "");
      setDraftIsActive(updated.isActive);
      setDraftSteps(updated.steps);
      toast.success("Tour saved successfully.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  // ── Step CRUD (local) ─────────────────────────────────────────────────────────
  const handleAddStep = (stepData: Omit<TourStepDto, "stepIndex">) => {
    const newStep: TourStepDto = {
      ...stepData,
      stepIndex: draftSteps.length,
    };
    setDraftSteps((prev) => [...prev, newStep]);
    setStepDialogOpen(false);
  };

  const handleEditStep = (stepData: Omit<TourStepDto, "stepIndex">) => {
    if (editingStepIndex === null) return;
    setDraftSteps((prev) =>
      prev.map((s, i) =>
        i === editingStepIndex ? { ...stepData, stepIndex: s.stepIndex } : s,
      ),
    );
    setStepDialogOpen(false);
    setEditingStepIndex(null);
  };

  const handleDeleteStep = (listIndex: number) => {
    setDraftSteps((prev) => {
      const next = prev.filter((_, i) => i !== listIndex);
      // Renumber stepIndex to keep 0..N-1 contiguous
      return next.map((s, i) => ({ ...s, stepIndex: i }));
    });
  };

  const openEditDialog = (listIndex: number) => {
    setEditingStepIndex(listIndex);
    setStepDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingStepIndex(null);
    setStepDialogOpen(true);
  };

  // ── Permission guard ─────────────────────────────────────────────────────────
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

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Loading tour...</p>
      </div>
    );
  }

  if (pageError || !tour) {
    return (
      <div className="p-6">
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError ?? "Tour not found."}
        </div>
        <Link
          href="/admin/tours"
          className="inline-block text-sm text-primary hover:underline"
        >
          Back to tours list
        </Link>
      </div>
    );
  }

  const editingStep =
    editingStepIndex !== null ? (draftSteps[editingStepIndex] ?? null) : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/admin/tours"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Tours
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Edit tour</h1>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isDirty || saving}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-tour="save-report-btn"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>

      {/* Metadata card */}
      <div className="mb-6 rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Tour metadata</h2>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="tour-name">
                Tour name <span className="text-destructive">*</span>
              </label>
              <input
                id="tour-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="tour-role">
                Role
              </label>
              <input
                id="tour-role"
                value={tour.roleName}
                disabled
                className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="tour-desc">
              Description
            </label>
            <textarea
              id="tour-desc"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="tour-active"
              type="checkbox"
              checked={draftIsActive}
              onChange={(e) => setDraftIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-primary"
            />
            <label htmlFor="tour-active" className="text-sm font-medium">
              Active (shown to users on this role)
            </label>
          </div>
        </div>
      </div>

      {/* Steps section */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Steps</h2>
            <p className="text-xs text-muted-foreground">
              {draftSteps.length} step{draftSteps.length !== 1 ? "s" : ""}. Drag rows to
              reorder — stepIndex updates automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddDialog}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add step
          </button>
        </div>

        <div className="p-4">
          <TourStepList
            steps={draftSteps}
            onChange={setDraftSteps}
            onEdit={openEditDialog}
            onDelete={handleDeleteStep}
          />
        </div>
      </div>

      {/* Dirty state reminder */}
      {isDirty && (
        <div className="mt-4 flex items-center justify-between rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm dark:border-yellow-700 dark:bg-yellow-900/20">
          <span className="text-yellow-800 dark:text-yellow-300">
            You have unsaved changes.
          </span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save now"}
          </button>
        </div>
      )}

      {/* Step form dialog */}
      <TourStepFormDialog
        open={stepDialogOpen}
        step={editingStep}
        onSave={editingStepIndex !== null ? handleEditStep : handleAddStep}
        onClose={() => {
          setStepDialogOpen(false);
          setEditingStepIndex(null);
        }}
      />
    </div>
  );
}
