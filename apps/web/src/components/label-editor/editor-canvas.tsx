"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { EditorField, PreviewAsset } from "./types";

interface EditorCanvasProps {
  paperWidthMm: number;
  paperHeightMm: number;
  fields: EditorField[];
  selectedFieldId: string | null;
  previewAsset: PreviewAsset | null;
  onSelectField: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<EditorField>) => void;
}

/** Resolve a field's display text from the preview asset */
function resolveFieldValue(
  field: EditorField,
  asset: PreviewAsset | null,
): string {
  if (field.type === "text") {
    return field.custom_value || "Text";
  }

  if (field.type === "field" && field.field_key) {
    if (!asset) return `{${field.field_key}}`;
    const map: Record<string, string | null> = {
      asset_number: asset.assetNumber,
      serial_number: asset.serialNumber,
      name: asset.name,
      location: asset.location,
      assigned_to: asset.assignedTo,
      purchase_date: asset.purchaseDate,
      warranty_end_date: asset.warrantyEndDate,
    };
    return map[field.field_key] ?? `{${field.field_key}}`;
  }

  return "";
}

export default function EditorCanvas({
  paperWidthMm,
  paperHeightMm,
  fields,
  selectedFieldId,
  previewAsset,
  onSelectField,
  onUpdateField,
}: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Track drag state via ref to avoid stale closures
  const dragRef = useRef<{
    fieldId: string;
    offsetMmX: number;
    offsetMmY: number;
  } | null>(null);

  // Observe container width for responsive scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scale: fit paper into container with some padding
  const maxCanvasWidth = containerWidth - 48; // 24px padding each side
  const scale = Math.min(maxCanvasWidth / paperWidthMm, 15); // cap at 15px/mm
  const canvasWidthPx = paperWidthMm * scale;
  const canvasHeightPx = paperHeightMm * scale;

  // Grid lines every 5mm
  const gridLines: { x?: number; y?: number }[] = [];
  for (let x = 5; x < paperWidthMm; x += 5) {
    gridLines.push({ x });
  }
  for (let y = 5; y < paperHeightMm; y += 5) {
    gridLines.push({ y });
  }

  // --- Drag handlers ---
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, field: EditorField) => {
      e.stopPropagation();
      e.preventDefault();
      onSelectField(field.id);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseMmX = (e.clientX - rect.left) / scale;
      const mouseMmY = (e.clientY - rect.top) / scale;

      dragRef.current = {
        fieldId: field.id,
        offsetMmX: mouseMmX - field.x,
        offsetMmY: mouseMmY - field.y,
      };
    },
    [onSelectField, scale],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseMmX = (e.clientX - rect.left) / scale;
      const mouseMmY = (e.clientY - rect.top) / scale;

      let newX = mouseMmX - drag.offsetMmX;
      let newY = mouseMmY - drag.offsetMmY;

      // Constrain to paper bounds
      newX = Math.max(0, Math.min(newX, paperWidthMm - 2));
      newY = Math.max(0, Math.min(newY, paperHeightMm - 2));

      // Round to 0.5mm
      newX = Math.round(newX * 2) / 2;
      newY = Math.round(newY * 2) / 2;

      onUpdateField(drag.fieldId, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [scale, paperWidthMm, paperHeightMm, onUpdateField]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      // Deselect if clicking on canvas background
      if (e.target === e.currentTarget) {
        onSelectField(null);
      }
    },
    [onSelectField],
  );

  // --- Render a field on the canvas ---
  const renderField = (field: EditorField) => {
    const isSelected = field.id === selectedFieldId;
    const left = field.x * scale;
    const top = field.y * scale;
    const widthPx = field.width ? field.width * scale : undefined;
    const fontSize = field.font_size
      ? Math.max(field.font_size * scale * 0.3, 8)
      : Math.max(10 * scale * 0.3, 8);

    const baseClasses = cn(
      "absolute cursor-move select-none",
      isSelected
        ? "ring-2 ring-blue-500 z-20"
        : "border border-dashed border-gray-300 z-10",
    );

    if (field.type === "barcode") {
      return (
        <div
          key={field.id}
          className={baseClasses}
          style={{ left, top, width: widthPx ?? 120 }}
          onMouseDown={(e) => handleMouseDown(e, field)}
          title={`Barcode (${field.x}, ${field.y}) mm`}
        >
          {/* Barcode graphic */}
          <div className="flex flex-col items-center px-1 py-0.5">
            <div className="flex h-6 w-full items-end justify-center gap-px">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-gray-800"
                  style={{
                    width: i % 3 === 0 ? 2 : 1,
                    height: 16 + (i % 5) * 2,
                  }}
                />
              ))}
            </div>
            <span
              className="mt-0.5 truncate text-center"
              style={{ fontSize: Math.max(fontSize * 0.8, 7) }}
            >
              {previewAsset?.assetNumber ?? "WDS-XX-0000-00000"}
            </span>
          </div>
        </div>
      );
    }

    if (field.type === "qr_code") {
      const qrSize = widthPx ?? 60;
      return (
        <div
          key={field.id}
          className={baseClasses}
          style={{ left, top, width: qrSize, height: qrSize }}
          onMouseDown={(e) => handleMouseDown(e, field)}
          title={`QR Code (${field.x}, ${field.y}) mm`}
        >
          <div className="flex h-full w-full items-center justify-center bg-white p-1">
            <div className="grid h-full w-full grid-cols-5 grid-rows-5 gap-px">
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    i % 3 === 0 || i % 7 === 0
                      ? "bg-gray-800"
                      : "bg-white",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (field.type === "divider") {
      return (
        <div
          key={field.id}
          className={baseClasses}
          style={{ left, top, width: widthPx ?? 100 }}
          onMouseDown={(e) => handleMouseDown(e, field)}
          title={`Divider (${field.x}, ${field.y}) mm`}
        >
          <div className="flex items-center py-1">
            <div className="h-px w-full bg-gray-800" />
          </div>
        </div>
      );
    }

    // text or field type
    const displayValue = resolveFieldValue(field, previewAsset);
    const labelPrefix =
      field.type === "field" && field.label ? `${field.label}: ` : "";

    return (
      <div
        key={field.id}
        className={baseClasses}
        style={{
          left,
          top,
          width: widthPx,
          maxWidth: canvasWidthPx - left,
        }}
        onMouseDown={(e) => handleMouseDown(e, field)}
        title={`${field.type === "field" ? field.field_key : "Text"} (${field.x}, ${field.y}) mm`}
      >
        <span
          className={cn("block truncate whitespace-nowrap px-0.5", {
            "font-bold": field.bold,
          })}
          style={{ fontSize }}
        >
          {labelPrefix}
          {displayValue || "(empty)"}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-1 items-start justify-center overflow-auto bg-gray-100 p-6"
      onClick={handleCanvasClick}
    >
      <div
        ref={canvasRef}
        className="relative bg-white shadow-md"
        style={{
          width: canvasWidthPx,
          height: canvasHeightPx,
          minWidth: canvasWidthPx,
          minHeight: canvasHeightPx,
        }}
        onClick={handleCanvasClick}
      >
        {/* Grid lines */}
        <svg
          className="pointer-events-none absolute inset-0"
          width={canvasWidthPx}
          height={canvasHeightPx}
        >
          {gridLines.map((line, i) => {
            if (line.x !== undefined) {
              return (
                <line
                  key={`v-${i}`}
                  x1={line.x * scale}
                  y1={0}
                  x2={line.x * scale}
                  y2={canvasHeightPx}
                  stroke="#e5e7eb"
                  strokeWidth={line.x % 10 === 0 ? 0.8 : 0.3}
                />
              );
            }
            if (line.y !== undefined) {
              return (
                <line
                  key={`h-${i}`}
                  x1={0}
                  y1={line.y * scale}
                  x2={canvasWidthPx}
                  y2={line.y * scale}
                  stroke="#e5e7eb"
                  strokeWidth={line.y % 10 === 0 ? 0.8 : 0.3}
                />
              );
            }
            return null;
          })}
        </svg>

        {/* Fields */}
        {fields.map(renderField)}
      </div>
    </div>
  );
}
