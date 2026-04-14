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
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/** Resolve an asset field value by key */
function resolveAssetValue(
  fieldKey: string | undefined,
  asset: PreviewAsset | null,
): string {
  if (!fieldKey) return "";
  if (!asset) return `{${fieldKey}}`;
  const map: Record<string, string | null> = {
    asset_number: asset.assetNumber,
    serial_number: asset.serialNumber,
    name: asset.name,
    location: asset.location,
    assigned_to: asset.assignedTo,
    purchase_date: asset.purchaseDate,
    warranty_end_date: asset.warrantyEndDate,
  };
  return map[fieldKey] ?? `{${fieldKey}}`;
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
    return resolveAssetValue(field.field_key, asset);
  }

  return "";
}

/** SVG barcode preview generated from text */
function BarcodeSVG({ text, width, height }: { text: string; width: number; height: number }) {
  const bars: Array<{ x: number; w: number }> = [];
  let xPos = 2;
  const charCodes = text.split("").map((c) => c.charCodeAt(0));
  for (let i = 0; i < Math.min(charCodes.length * 3 + 6, 60); i++) {
    const code = charCodes[i % charCodes.length] ?? 65;
    const barWidth = ((code + i) % 3) + 1;
    if (i % 2 === 0) bars.push({ x: xPos, w: barWidth });
    xPos += barWidth + 0.5;
  }
  const totalW = xPos;
  const sx = (width - 4) / totalW;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="bg-white">
      {bars.map((bar, i) => (
        <rect key={i} x={2 + bar.x * sx} y={2} width={Math.max(bar.w * sx, 0.5)} height={height - 14} fill="#111" />
      ))}
      <text x={width / 2} y={height - 2} textAnchor="middle" fontSize={Math.min(9, height * 0.2)} fill="#333" fontFamily="monospace">
        {text.length > 25 ? text.slice(0, 25) + "..." : text}
      </text>
    </svg>
  );
}

/** SVG QR code preview generated from text */
function QrCodeSVG({ text, size }: { text: string; size: number }) {
  const gridSize = 7;
  const cellSize = (size - 4) / gridSize;
  const charCodes = text.split("").map((c) => c.charCodeAt(0));
  const cells: Array<{ row: number; col: number }> = [];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      // Fixed finder pattern corners
      const isFinderCorner =
        (row < 2 && col < 2) ||
        (row < 2 && col >= gridSize - 2) ||
        (row >= gridSize - 2 && col < 2);
      const idx = row * gridSize + col;
      const code = charCodes[idx % charCodes.length] ?? 65;
      if (isFinderCorner || (code + idx) % 3 === 0) {
        cells.push({ row, col });
      }
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="bg-white">
      {cells.map((cell, i) => (
        <rect
          key={i}
          x={2 + cell.col * cellSize}
          y={2 + cell.row * cellSize}
          width={cellSize - 0.5}
          height={cellSize - 0.5}
          fill="#111"
        />
      ))}
    </svg>
  );
}

export default function EditorCanvas({
  paperWidthMm,
  paperHeightMm,
  fields,
  selectedFieldId,
  previewAsset,
  onSelectField,
  onUpdateField,
  onDragStart,
  onDragEnd,
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
      onDragStart?.();
    },
    [onSelectField, scale, onDragStart],
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
      if (dragRef.current) {
        onDragEnd?.();
      }
      dragRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [scale, paperWidthMm, paperHeightMm, onUpdateField, onDragEnd]);

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
      const barcodeW = widthPx ?? 120;
      const barcodeH = field.height ? field.height * scale : barcodeW * 0.4;
      const barcodeText = resolveAssetValue(field.field_key ?? "asset_number", previewAsset) || "WDS-XX-0000-00000";
      return (
        <div
          key={field.id}
          className={baseClasses}
          style={{ left, top, width: barcodeW, height: barcodeH }}
          onMouseDown={(e) => handleMouseDown(e, field)}
          title={`Barcode (${field.x}, ${field.y}) mm`}
        >
          <BarcodeSVG text={barcodeText} width={barcodeW} height={barcodeH} />
        </div>
      );
    }

    if (field.type === "qr_code") {
      const qrW = widthPx ?? 60;
      const qrH = field.height ? field.height * scale : qrW;
      const qrSize = Math.min(qrW, qrH);
      const qrText = resolveAssetValue(field.field_key ?? "asset_number", previewAsset) || "WDS-XX-0000-00000";
      return (
        <div
          key={field.id}
          className={baseClasses}
          style={{ left, top, width: qrW, height: qrH }}
          onMouseDown={(e) => handleMouseDown(e, field)}
          title={`QR Code (${field.x}, ${field.y}) mm`}
        >
          <QrCodeSVG text={qrText} size={qrSize} />
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
