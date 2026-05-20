"use client";

/**
 * TourStepList — drag-and-drop sortable list of tour steps.
 *
 * Encapsulates DndContext + SortableContext wiring. When a drag ends, the
 * component recomputes stepIndex to be 0..N-1 contiguous before calling
 * onChange, matching the server's Zod enforcement.
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { TourStepDto } from "@/types/admin";
import { GripVertical } from "lucide-react";

// ── Per-row sortable item ──────────────────────────────────────────────────────

interface SortableStepRowProps {
  step: TourStepDto;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableStepRow({ step, onEdit, onDelete }: SortableStepRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(step.stepIndex) });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b last:border-b-0 bg-card"
    >
      {/* Drag handle */}
      <td className="px-3 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag step ${step.stepIndex}`}
          className="cursor-grab text-muted-foreground touch-none active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>

      {/* Step index */}
      <td className="px-3 py-3 text-center">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {step.stepIndex}
        </span>
      </td>

      {/* Title key */}
      <td className="px-3 py-3 max-w-[180px]">
        <p className="truncate font-mono text-xs text-foreground">{step.title}</p>
        {!step.isActive && (
          <span className="mt-0.5 inline-block rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            inactive
          </span>
        )}
      </td>

      {/* Target element */}
      <td className="px-3 py-3 max-w-[160px]">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {step.targetElement}
        </span>
      </td>

      {/* Route */}
      <td className="px-3 py-3">
        <span className="font-mono text-xs text-muted-foreground">{step.route}</span>
      </td>

      {/* Position */}
      <td className="px-3 py-3 text-xs text-muted-foreground capitalize">{step.position}</td>

      {/* Required permission */}
      <td className="px-3 py-3 text-xs text-muted-foreground">
        {step.requiredPermission
          ? `${step.requiredPermission.resource}:${step.requiredPermission.action}`
          : "—"}
      </td>

      {/* Actions */}
      <td className="px-3 py-3 text-right">
        <button
          type="button"
          onClick={onEdit}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface TourStepListProps {
  steps: TourStepDto[];
  onChange: (next: TourStepDto[]) => void;
  onEdit: (idx: number) => void;
  onDelete: (idx: number) => void;
}

export default function TourStepList({
  steps,
  onChange,
  onEdit,
  onDelete,
}: TourStepListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = steps.findIndex((s) => String(s.stepIndex) === active.id);
    const newIndex = steps.findIndex((s) => String(s.stepIndex) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(steps, oldIndex, newIndex);

    // Recompute stepIndex to maintain 0..N-1 contiguous sequence
    const renumbered = reordered.map((step, i) => ({ ...step, stepIndex: i }));
    onChange(renumbered);
  };

  if (steps.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No steps yet. Click &quot;Add step&quot; to create the first one.
      </p>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={steps.map((s) => String(s.stepIndex))}
        strategy={verticalListSortingStrategy}
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-3 py-3 w-8" />
                <th className="px-3 py-3 w-12 text-center">#</th>
                <th className="px-3 py-3">Title key</th>
                <th className="px-3 py-3">Target</th>
                <th className="px-3 py-3">Route</th>
                <th className="px-3 py-3">Position</th>
                <th className="px-3 py-3">Permission</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {steps.map((step, listIndex) => (
                <SortableStepRow
                  key={step.stepIndex}
                  step={step}
                  onEdit={() => onEdit(listIndex)}
                  onDelete={() => onDelete(listIndex)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </SortableContext>
    </DndContext>
  );
}
