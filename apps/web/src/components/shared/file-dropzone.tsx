"use client";

import { useCallback, useRef, useState } from "react";
import { FileSpreadsheet, FileText, UploadCloud, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Which family of files this dropzone accepts. Extending the union means
 * adding one entry to KIND_CONFIG — nothing else in the component is
 * type-specific.
 */
export type FileDropzoneKind = "excel" | "pdf";

interface KindConfig {
  extensions: readonly string[];
  /**
   * MIME types the browser is *expected* to report. Used only as a secondary
   * signal — browsers are inconsistent (Chrome reports the long OOXML string
   * for .xlsx, Safari sometimes drops type entirely, and a file copied from a
   * Windows share arrives as application/octet-stream), so the extension is
   * the source of truth and a generic/absent type is always tolerated.
   */
  mimeHints: readonly string[];
  Icon: LucideIcon;
  /** Human noun used in prompts and aria labels, e.g. "Excel file". */
  noun: string;
  /** Extension summary shown in the hint line, e.g. ".xlsx or .xls". */
  extensionLabel: string;
  wrongExtensionMessage: string;
  wrongContentMessage: string;
}

const KIND_CONFIG: Record<FileDropzoneKind, KindConfig> = {
  excel: {
    extensions: [".xlsx", ".xls"],
    mimeHints: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
    Icon: FileSpreadsheet,
    noun: "Excel file",
    extensionLabel: ".xlsx or .xls",
    wrongExtensionMessage: "Only .xlsx or .xls files are accepted.",
    wrongContentMessage: "This file doesn't appear to be a valid Excel file.",
  },
  pdf: {
    extensions: [".pdf"],
    mimeHints: ["application/pdf"],
    Icon: FileText,
    noun: "PDF",
    extensionLabel: ".pdf",
    wrongExtensionMessage: "Only .pdf files are accepted.",
    wrongContentMessage: "This file doesn't appear to be a valid PDF.",
  },
};

interface FileDropzoneProps {
  /** Currently-selected file (controlled by parent). */
  file: File | null;
  /** Called with the new file, or null when user clears it. */
  onChange: (file: File | null) => void;
  /** Called with a user-facing error message when validation fails. */
  onError: (message: string) => void;
  /** Max size in megabytes. */
  maxSizeMb: number;
  /** File family to accept. Defaults to "excel" for existing callers. */
  kind?: FileDropzoneKind;
  /** Optional disable (e.g. while uploading). */
  disabled?: boolean;
  "data-tour"?: string;
}

function hasAcceptedExtension(name: string, config: KindConfig): boolean {
  const lower = name.toLowerCase();
  return config.extensions.some((ext) => lower.endsWith(ext));
}

/** True when the browser-reported type doesn't contradict the extension. */
function hasPlausibleMime(type: string, config: KindConfig): boolean {
  if (!type) return true;
  if (type === "application/octet-stream") return true;
  return config.mimeHints.includes(type);
}

function looksLikeAcceptedFile(file: File, config: KindConfig): boolean {
  if (!hasAcceptedExtension(file.name, config)) return false;
  // A confidently-wrong type (e.g. a PDF renamed to .xlsx) is rejected here;
  // the server re-checks magic bytes regardless.
  return hasPlausibleMime(file.type, config);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileDropzone({
  file,
  onChange,
  onError,
  maxSizeMb,
  kind = "excel",
  disabled,
  "data-tour": dataTour,
}: FileDropzoneProps) {
  const config = KIND_CONFIG[kind];
  const { Icon } = config;
  const inputRef = useRef<HTMLInputElement>(null);
  // `dragState` separates "something is being dragged over me" from the
  // sub-state of "...and it looks like a file we can accept". The latter
  // tints the dropzone red so the user gets feedback *before* dropping.
  const [dragState, setDragState] = useState<"idle" | "valid" | "invalid">(
    "idle",
  );

  const acceptOrReject = useCallback(
    (incoming: File | null) => {
      if (!incoming) {
        onChange(null);
        return;
      }
      if (!hasAcceptedExtension(incoming.name, config)) {
        onError(config.wrongExtensionMessage);
        return;
      }
      if (!looksLikeAcceptedFile(incoming, config)) {
        onError(config.wrongContentMessage);
        return;
      }
      if (incoming.size > maxSizeMb * 1024 * 1024) {
        onError(`File must be smaller than ${maxSizeMb} MB.`);
        return;
      }
      onChange(incoming);
    },
    [config, maxSizeMb, onChange, onError],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    acceptOrReject(selected);
    // Reset the input value so selecting the same file again still fires
    // change (browsers suppress duplicate selections otherwise).
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    // Inspect items, not files — `dataTransfer.files` is empty during dragover
    // for security reasons. `items` exposes only kind+type, which is enough
    // to decide whether to show the "looks valid" green state.
    const items = Array.from(e.dataTransfer.items);
    const firstFile = items.find((it) => it.kind === "file");
    if (!firstFile) {
      setDragState("invalid");
      return;
    }
    // We can only tell file type here, not name — so a matching or generic
    // MIME is enough for the "looks valid" tint; the name check happens on
    // drop.
    setDragState(hasPlausibleMime(firstFile.type, config) ? "valid" : "invalid");
  };

  const handleDragLeave = () => setDragState("idle");

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragState("idle");
    if (disabled) return;
    const dropped = e.dataTransfer.files?.[0] ?? null;
    acceptOrReject(dropped);
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  };

  // ── Selected-file state ───────────────────────────────────────────
  if (file) {
    return (
      <div
        className="rounded-lg border border-green-200 bg-green-50/50 p-4"
        data-tour={dataTour}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-green-100">
            <Icon className="h-5 w-5 text-green-700" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatBytes(file.size)} · Ready to upload
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={openPicker}
                disabled={disabled}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                Replace file
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={disabled}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={config.extensions.join(",")}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  // ── Empty / drag state ────────────────────────────────────────────
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Drop a ${config.noun} here, or click to browse`}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-tour={dataTour}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        disabled && "cursor-not-allowed opacity-50",
        dragState === "valid" && "border-green-400 bg-green-50",
        dragState === "invalid" && "border-red-400 bg-red-50",
        dragState === "idle" && "border-muted-foreground/30 hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "mb-3 flex h-12 w-12 items-center justify-center rounded-full",
          dragState === "valid"
            ? "bg-green-100 text-green-700"
            : dragState === "invalid"
              ? "bg-red-100 text-red-700"
              : "bg-muted text-muted-foreground",
        )}
      >
        <UploadCloud className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium">
        {dragState === "invalid"
          ? "That file type isn't supported"
          : dragState === "valid"
            ? "Drop to upload"
            : `Drag & drop your ${config.noun} here`}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        or{" "}
        <span className="text-primary hover:underline">browse from your computer</span>
        {" · "}
        {config.extensionLabel} up to {maxSizeMb} MB
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={config.extensions.join(",")}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
