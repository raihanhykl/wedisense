"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

  // ── Dirty tracking ────────────────────────────────────────────
  const [isDirty, setIsDirty] = useState(false);
  const initialLoadDone = useRef(false);

  // ── Undo / Redo history ──────────────────────────────────────
  const [history, setHistory] = useState<EditorState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isDraggingRef = useRef(false);
  const isUndoRedoRef = useRef(false);

  const pushHistory = useCallback((newState: EditorState) => {
    setHistory((prev) => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const updated = [...trimmed, newState].slice(-50);
      return updated;
    });
    setHistoryIndex((prev) => Math.min(prev + 1, 49));
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoRef.current = true;
    const prevState = history[historyIndex - 1];
    if (prevState) {
      setState(prevState);
      setHistoryIndex((i) => i - 1);
    }
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoRef.current = true;
    const nextState = history[historyIndex + 1];
    if (nextState) {
      setState(nextState);
      setHistoryIndex((i) => i + 1);
    }
  }, [historyIndex, history]);

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
        const loadedState: EditorState = {
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
            height: f.height,
            font_size: f.font_size,
            bold: f.bold,
            custom_value: f.custom_value,
          })),
          selectedFieldId: null,
        };
        setState(loadedState);
        setHistory([loadedState]);
        setHistoryIndex(0);
        initialLoadDone.current = true;
        setCurrentId(templateId);
      } catch {
        // handle silently
      }
    }
    void loadTemplate();
  }, [templateId]);

  // ── Initialize history for new templates ──────────────────────
  useEffect(() => {
    if (!templateId && history.length === 0) {
      setHistory([state]);
      setHistoryIndex(0);
      initialLoadDone.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Track dirty + push history on meaningful state changes ───
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    if (isDraggingRef.current) {
      // During drag we mark dirty but don't push history
      setIsDirty(true);
      return;
    }
    setIsDirty(true);
    pushHistory(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.name, state.description, state.paperWidthMm, state.paperHeightMm, state.isDefault, state.fields]);

  // ── beforeunload warning ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── Keyboard shortcuts for undo/redo ─────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (isCtrl && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (isCtrl && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

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
        height: f.height || undefined,
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
      setIsDirty(false);
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
          onClick={() => {
            if (isDirty) {
              if (!window.confirm("You have unsaved changes. Leave without saving?")) return;
            }
            router.push("/admin/print");
          }}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          &larr; Back
        </button>

        <div className="h-6 w-px bg-gray-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          onClick={undo}
          disabled={historyIndex <= 0}
          className="rounded-md border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          className="rounded-md border px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
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
          onDragStart={() => { isDraggingRef.current = true; }}
          onDragEnd={() => {
            isDraggingRef.current = false;
            setState((current) => {
              pushHistory(current);
              return current;
            });
          }}
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
