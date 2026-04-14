"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/api";
import type { LabelTemplateItem, PrintJobItem } from "@/types/admin";

// ── Zod schema ─────────────────────────────────────────────────────
const printSchema = z.object({
  templateId: z.string().min(1, "Template is required"),
  copiesPerAsset: z.coerce.number().min(1, "At least 1 copy required"),
});

type PrintFormValues = z.infer<typeof printSchema>;

// ── Props ──────────────────────────────────────────────────────────
interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  assetIds: string[];
}

// ── Component ──────────────────────────────────────────────────────
export default function PrintDialog({
  open,
  onClose,
  assetIds,
}: PrintDialogProps) {
  const [templates, setTemplates] = useState<LabelTemplateItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [createdJob, setCreatedJob] = useState<PrintJobItem | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PrintFormValues>({
    resolver: zodResolver(printSchema),
    defaultValues: {
      templateId: "",
      copiesPerAsset: 1,
    },
  });

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await apiGet<LabelTemplateItem[]>("/api/label-templates");
      setTemplates(data);
    } catch {
      // handle error silently
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCreatedJob(null);
      setSubmitError("");
      reset({ templateId: "", copiesPerAsset: 1 });
      void fetchTemplates();
    }
  }, [open, reset, fetchTemplates]);

  const onSubmit = async (data: PrintFormValues) => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const job = await apiPost<PrintJobItem>("/api/print-jobs", {
        templateId: data.templateId,
        assetIds,
        copiesPerAsset: data.copiesPerAsset,
      });
      setCreatedJob(job);
      if (job.pdfUrl) {
        window.open(job.pdfUrl, "_blank");
      }
    } catch {
      setSubmitError("Failed to create print job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Print Labels</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>

        {/* Selected count */}
        <p className="mb-4 text-sm text-muted-foreground">
          {assetIds.length} asset{assetIds.length !== 1 ? "s" : ""} selected
        </p>

        {createdJob ? (
          <div className="space-y-4">
            <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              Print job created successfully.
            </div>
            {createdJob.pdfUrl ? (
              <a
                href={createdJob.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Download PDF
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                PDF is being generated. Check the Print Jobs tab for the
                download link.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Template */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Template
              </label>
              <select
                {...register("templateId")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select template...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isDefault ? " (Default)" : ""}
                  </option>
                ))}
              </select>
              {errors.templateId?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.templateId.message}
                </p>
              )}
            </div>

            {/* Copies */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                Copies per Asset
              </label>
              <input
                type="number"
                min={1}
                {...register("copiesPerAsset")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              {errors.copiesPerAsset?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {errors.copiesPerAsset.message}
                </p>
              )}
            </div>

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Creating..." : "Print Labels"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
