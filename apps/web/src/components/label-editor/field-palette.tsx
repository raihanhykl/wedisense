"use client";

import { cn } from "@/lib/utils";
import {
  FIELD_TYPE_OPTIONS,
  ASSET_FIELD_OPTIONS,
  type EditorField,
} from "./types";

interface FieldPaletteProps {
  onAddField: (field: Omit<EditorField, "id">) => void;
  paperWidthMm: number;
  paperHeightMm: number;
}

export default function FieldPalette({
  onAddField,
  paperWidthMm,
  paperHeightMm,
}: FieldPaletteProps) {
  const centerX = Math.round(paperWidthMm / 4);
  const centerY = Math.round(paperHeightMm / 4);

  const handleAddElement = (type: EditorField["type"]) => {
    const base: Omit<EditorField, "id"> = {
      type,
      x: centerX,
      y: centerY,
      font_size: 10,
      bold: false,
    };

    switch (type) {
      case "barcode":
        onAddField({ ...base, width: Math.min(40, paperWidthMm - 4) });
        break;
      case "qr_code":
        onAddField({ ...base, width: Math.min(15, paperWidthMm - 4) });
        break;
      case "text":
        onAddField({ ...base, custom_value: "Text" });
        break;
      case "divider":
        onAddField({
          ...base,
          width: Math.min(40, paperWidthMm - 4),
        });
        break;
      default:
        onAddField(base);
    }
  };

  const handleAddAssetField = (key: string, label: string) => {
    onAddField({
      type: "field",
      field_key: key,
      label,
      x: centerX,
      y: centerY,
      font_size: 10,
      bold: false,
    });
  };

  return (
    <div className="flex h-full w-[200px] flex-col border-r bg-card">
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Palette</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Elements section */}
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Elements
        </p>
        <div className="mb-4 space-y-1">
          {FIELD_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => handleAddElement(opt.type)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm",
                "hover:bg-accent cursor-pointer transition-colors",
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">
                {opt.icon}
              </span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>

        {/* Asset Fields section */}
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Asset Fields
        </p>
        <div className="space-y-1">
          {ASSET_FIELD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleAddAssetField(opt.key, opt.label)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm",
                "hover:bg-accent cursor-pointer transition-colors",
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-muted text-xs font-bold">
                F
              </span>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
