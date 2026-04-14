"use client";

import { cn } from "@/lib/utils";
import { ASSET_FIELD_OPTIONS, type EditorField } from "./types";

interface PropertyPanelProps {
  field: EditorField | null;
  onUpdateField: (id: string, updates: Partial<EditorField>) => void;
  onDeleteField: (id: string) => void;
}

const TYPE_LABELS: Record<EditorField["type"], string> = {
  barcode: "Barcode",
  qr_code: "QR Code",
  text: "Text",
  field: "Asset Field",
  divider: "Divider",
};

export default function PropertyPanel({
  field,
  onUpdateField,
  onDeleteField,
}: PropertyPanelProps) {
  if (!field) {
    return (
      <div className="flex h-full w-[280px] flex-col border-l bg-card">
        <div className="border-b px-4 py-2">
          <h3 className="text-sm font-semibold">Properties</h3>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-muted-foreground">
            Select a field on the canvas to edit its properties
          </p>
        </div>
      </div>
    );
  }

  const handleChange = (updates: Partial<EditorField>) => {
    onUpdateField(field.id, updates);
  };

  const showTextProps = field.type === "text" || field.type === "field";

  return (
    <div className="flex h-full w-[280px] flex-col border-l bg-card">
      <div className="border-b px-4 py-2">
        <h3 className="text-sm font-semibold">Properties</h3>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Type badge */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Type
          </label>
          <span
            className={cn(
              "inline-block rounded-full px-3 py-1 text-xs font-medium",
              "bg-muted text-muted-foreground",
            )}
          >
            {TYPE_LABELS[field.type]}
          </span>
        </div>

        {/* Position */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              X (mm)
            </label>
            <input
              type="number"
              step={0.5}
              value={field.x}
              onChange={(e) =>
                handleChange({ x: parseFloat(e.target.value) || 0 })
              }
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Y (mm)
            </label>
            <input
              type="number"
              step={0.5}
              value={field.y}
              onChange={(e) =>
                handleChange({ y: parseFloat(e.target.value) || 0 })
              }
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Width */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Width (mm)
          </label>
          <input
            type="number"
            step={0.5}
            value={field.width ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              handleChange({
                width: val === "" ? undefined : parseFloat(val) || 0,
              });
            }}
            placeholder="Auto"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>

        {/* Font Size & Bold (for text/field types) */}
        {showTextProps && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Font Size
              </label>
              <input
                type="number"
                min={4}
                max={72}
                value={field.font_size ?? 10}
                onChange={(e) =>
                  handleChange({
                    font_size: parseInt(e.target.value, 10) || 10,
                  })
                }
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="prop-bold"
                checked={field.bold ?? false}
                onChange={(e) => handleChange({ bold: e.target.checked })}
                className="rounded border"
              />
              <label htmlFor="prop-bold" className="text-sm font-medium">
                Bold
              </label>
            </div>
          </>
        )}

        {/* Asset Field selector */}
        {field.type === "field" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Asset Field
            </label>
            <select
              value={field.field_key ?? ""}
              onChange={(e) => {
                const opt = ASSET_FIELD_OPTIONS.find(
                  (o) => o.key === e.target.value,
                );
                handleChange({
                  field_key: e.target.value,
                  label: opt?.label,
                });
              }}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Select field...</option>
              {ASSET_FIELD_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Custom text */}
        {field.type === "text" && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Custom Text
              </label>
              <input
                type="text"
                value={field.custom_value ?? ""}
                onChange={(e) =>
                  handleChange({ custom_value: e.target.value })
                }
                placeholder="Enter text..."
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Label
              </label>
              <input
                type="text"
                value={field.label ?? ""}
                onChange={(e) => handleChange({ label: e.target.value })}
                placeholder="Optional label"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </div>
          </>
        )}

        {/* Field label override */}
        {field.type === "field" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Label
            </label>
            <input
              type="text"
              value={field.label ?? ""}
              onChange={(e) => handleChange({ label: e.target.value })}
              placeholder="Optional label"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="border-t p-4">
        <button
          type="button"
          onClick={() => onDeleteField(field.id)}
          className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Delete Field
        </button>
      </div>
    </div>
  );
}
