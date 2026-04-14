"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { apiGet, apiGetPaginated, apiPost, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import ProtectedRoute from "@/components/shared/protected-route";
import FieldPalette from "@/components/label-editor/field-palette";
import EditorCanvas from "@/components/label-editor/editor-canvas";
import PropertyPanel from "@/components/label-editor/property-panel";
import type {
  EditorField,
  EditorState,
  PreviewAsset,
} from "@/components/label-editor/types";
import type { AssetListItem, LabelTemplateItem } from "@/types/admin";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function mapAssetToPreview(asset: AssetListItem): PreviewAsset {
  return {
    id: asset.id,
    assetNumber: asset.assetNumber,
    name: asset.name,
    serialNumber: asset.serialNumber,
    location: asset.location?.name ?? "",
    assignedTo: asset.assignedTo?.name ?? null,
    purchaseDate: asset.purchaseDate,
    warrantyEndDate: asset.warrantyEndDate,
  };
}

function EditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateId = searchParams.get("id");
  const isEdit = !!templateId;

  // ── Editor state ──────────────────────────────────────────────
  const [state, setState] = useState<EditorState>({
    name: "",
    description: "",
    paperWidthMm: 70,
    paperHeightMm: 40,
    isDefault: false,
    fields: [],
    selectedFieldId: null,
  });

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(templateId);

  // ── Preview assets ────────────────────────────────────────────
  const [previewAssets, setPreviewAssets] = useState<PreviewAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const previewAsset =
    previewAssets.find((a) => a.id === selectedAssetId) ?? previewAssets[0] ?? null;

  // ── Load assets for preview ───────────────────────────────────
  useEffect(() => {
    async function loadAssets() {
      try {
        const result = await apiGetPaginated<AssetListItem[]>("/api/assets", {
          limit: 20,
        });
        const mapped = result.data.map(mapAssetToPreview);
        setPreviewAssets(mapped);
        const first = mapped[0];
        if (first) {
          setSelectedAssetId(first.id);
        }
      } catch {
        // silent
      }
    }
    void loadAssets();
  }, []);

  // ── Load existing template ────────────────────────────────────
  useEffect(() => {
    if (!templateId) return;

    async function loadTemplate() {
      try {
        const tpl = await apiGet<LabelTemplateItem>(
          `/api/label-templates/${templateId}`,
        );
        setState({
          name: tpl.name,
          description: tpl.description ?? "",
          paperWidthMm: tpl.paperWidthMm,
          paperHeightMm: tpl.paperHeightMm,
          isDefault: tpl.isDefault,
          fields: tpl.fields.map((f) => ({
            id: crypto.randomUUID(),
            type: f.type,
            field_key: f.field_key,
            label: f.label,
            x: f.x,
            y: f.y,
            width: f.width,
            font_size: f.font_size,
            bold: f.bold,
            custom_value: f.custom_value,
          })),
          selectedFieldId: null,
        });
        setCurrentId(templateId);
      } catch {
        // handle silently
      }
    }
    void loadTemplate();
  }, [templateId]);

  // ── Field operations ──────────────────────────────────────────
  const handleAddField = useCallback((fieldData: Omit<EditorField, "id">) => {
    const newField: EditorField = {
      ...fieldData,
      id: crypto.randomUUID(),
    };
    setState((prev) => ({
      ...prev,
      fields: [...prev.fields, newField],
      selectedFieldId: newField.id,
    }));
  }, []);

  const handleUpdateField = useCallback(
    (id: string, updates: Partial<EditorField>) => {
      setState((prev) => ({
        ...prev,
        fields: prev.fields.map((f) =>
          f.id === id ? { ...f, ...updates } : f,
        ),
      }));
    },
    [],
  );

  const handleDeleteField = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      fields: prev.fields.filter((f) => f.id !== id),
      selectedFieldId: prev.selectedFieldId === id ? null : prev.selectedFieldId,
    }));
  }, []);

  const handleSelectField = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedFieldId: id }));
  }, []);

  const selectedField =
    state.fields.find((f) => f.id === state.selectedFieldId) ?? null;

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!state.name.trim()) {
      setSaveError("Template name is required");
      setSaveStatus("error");
      return;
    }

    setSaveStatus("saving");
    setSaveError("");

    const payload = {
      name: state.name,
      description: state.description || undefined,
      paperWidthMm: state.paperWidthMm,
      paperHeightMm: state.paperHeightMm,
      isDefault: state.isDefault,
      fields: state.fields.map((f) => ({
        type: f.type,
        field_key: f.field_key || undefined,
        label: f.label || undefined,
        x: f.x,
        y: f.y,
        width: f.width || undefined,
        font_size: f.font_size || undefined,
        bold: f.bold || undefined,
        custom_value: f.custom_value || undefined,
      })),
    };

    try {
      if (currentId) {
        await apiPut(`/api/label-templates/${currentId}`, payload);
      } else {
        const created = await apiPost<LabelTemplateItem>(
          "/api/label-templates",
          payload,
        );
        setCurrentId(created.id);
        // Update URL without full navigation
        window.history.replaceState(
          null,
          "",
          `/admin/print/editor?id=${created.id}`,
        );
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err: unknown) {
      setSaveError(getApiErrorMessage(err, "Failed to save template"));
      setSaveStatus("error");
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-2">
        <button
          type="button"
          onClick={() => router.push("/admin/print")}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          &larr; Back
        </button>

        <div className="h-6 w-px bg-gray-200" />

        {/* Template name */}
        <input
          type="text"
          value={state.name}
          onChange={(e) =>
            setState((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder="Template Name"
          className="w-48 rounded-md border bg-background px-2 py-1.5 text-sm font-medium"
        />

        {/* Paper size */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>Size:</span>
          <input
            type="number"
            min={10}
            max={300}
            value={state.paperWidthMm}
            onChange={(e) =>
              setState((prev) => ({
                ...prev,
                paperWidthMm: parseInt(e.target.value, 10) || 10,
              }))
            }
            className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <span>&times;</span>
          <input
            type="number"
            min={10}
            max={300}
            value={state.paperHeightMm}
            onChange={(e) =>
              setState((prev) => ({
                ...prev,
                paperHeightMm: parseInt(e.target.value, 10) || 10,
              }))
            }
            className="w-16 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <span>mm</span>
        </div>

        {/* Default toggle */}
        <button
          type="button"
          onClick={() =>
            setState((prev) => ({ ...prev, isDefault: !prev.isDefault }))
          }
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            state.isDefault ? "bg-primary" : "bg-muted",
          )}
          title="Set as default template"
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform",
              state.isDefault ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
        <span className="text-xs text-muted-foreground">Default</span>

        <div className="flex-1" />

        {/* Save status */}
        {saveStatus === "saved" && (
          <span className="text-xs text-green-600">Saved</span>
        )}
        {saveStatus === "error" && (
          <span className="max-w-[200px] truncate text-xs text-red-600">
            {saveError}
          </span>
        )}
        {saveStatus === "saving" && (
          <span className="text-xs text-muted-foreground">Saving...</span>
        )}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveStatus === "saving"}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saveStatus === "saving" ? "Saving..." : "Save"}
        </button>
      </header>

      {/* ── Three-panel layout ────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <FieldPalette
          onAddField={handleAddField}
          paperWidthMm={state.paperWidthMm}
          paperHeightMm={state.paperHeightMm}
        />

        <EditorCanvas
          paperWidthMm={state.paperWidthMm}
          paperHeightMm={state.paperHeightMm}
          fields={state.fields}
          selectedFieldId={state.selectedFieldId}
          previewAsset={previewAsset}
          onSelectField={handleSelectField}
          onUpdateField={handleUpdateField}
        />

        <PropertyPanel
          field={selectedField}
          onUpdateField={handleUpdateField}
          onDeleteField={handleDeleteField}
        />
      </div>

      {/* ── Footer — Preview asset selector ───────────────────── */}
      <footer className="flex items-center gap-3 border-t bg-white px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Preview Asset:
        </span>
        <select
          value={selectedAssetId}
          onChange={(e) => setSelectedAssetId(e.target.value)}
          className="max-w-xs flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {previewAssets.length === 0 && (
            <option value="">No assets available</option>
          )}
          {previewAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} ({asset.assetNumber})
            </option>
          ))}
        </select>
      </footer>
    </div>
  );
}

export default function LabelEditorPage() {
  return (
    <ProtectedRoute permission="labels:manage">
      <EditorContent />
    </ProtectedRoute>
  );
}
