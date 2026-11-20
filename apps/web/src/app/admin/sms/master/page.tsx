"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api";
import { isConflict, newIdempotencyKey, smsPost, smsPut, smsErrorMessage } from "@/lib/sms/client";
import { useShowroom } from "@/components/sms/showroom-context";
import { SMS_PERMISSIONS } from "@wedisense/shared";
import type { VehicleModelRow, VehicleVariantRow } from "@/lib/sms/types";

// ── Model form dialog ─────────────────────────────────────────────────

interface ModelFormDialogProps {
  model: VehicleModelRow | null; // null = create
  onClose: () => void;
  onSuccess: () => void;
}

function ModelFormDialog({ model, onClose, onSuccess }: ModelFormDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [code, setCode] = useState(model?.code ?? "");
  const [name, setName] = useState(model?.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = model !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await smsPut(`/api/sms/master/vehicle-models/${model.id}`, { name }, idempotencyKey);
        toast.success("Model updated.");
      } else {
        await smsPost("/api/sms/master/vehicle-models", { code, name }, idempotencyKey);
        toast.success("Model created.");
      }
      onSuccess();
    } catch (err) {
      const conflict = isConflict(err);
      setError(smsErrorMessage(err, conflict ? "A model with this code already exists." : "Failed to save model."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">{isEdit ? "Edit model" : "Add model"}</h2>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            {!isEdit && (
              <div>
                <label className="mb-1 block text-sm font-medium">Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  placeholder="e.g. ATHENA"
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm uppercase"
                  data-tour="sms-model-code"
                />
                <p className="mt-1 text-xs text-muted-foreground">Unique identifier. Cannot be changed later.</p>
              </div>
            )}
            {isEdit && (
              <div>
                <label className="mb-1 block text-sm font-medium">Code</label>
                <input
                  type="text"
                  value={model.code}
                  disabled
                  className="w-full rounded-md border bg-muted px-3 py-2 font-mono text-sm text-muted-foreground"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Athena"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-model-save"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add model"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Variant form dialog ───────────────────────────────────────────────

interface VariantFormDialogProps {
  variant: VehicleVariantRow | null; // null = create
  models: VehicleModelRow[];
  defaultModelId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function VariantFormDialog({ variant, models, defaultModelId, onClose, onSuccess }: VariantFormDialogProps) {
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [modelId, setModelId] = useState(variant?.modelId ?? defaultModelId ?? models[0]?.id ?? "");
  const [name, setName] = useState(variant?.name ?? "");
  const [batteryVariant, setBatteryVariant] = useState(variant?.batteryVariant ?? "");
  const [color, setColor] = useState(variant?.color ?? "");
  const [colorHex, setColorHex] = useState(variant?.colorHex ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = variant !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        modelId: isEdit ? undefined : modelId,
        name,
        batteryVariant: batteryVariant.trim() || undefined,
        color,
        colorHex: colorHex || undefined,
      };
      if (isEdit) {
        await smsPut(`/api/sms/master/vehicle-variants/${variant.id}`, { name, batteryVariant: batteryVariant.trim() || null, color, colorHex: colorHex || null }, idempotencyKey);
        toast.success("Variant updated.");
      } else {
        await smsPost("/api/sms/master/vehicle-variants", payload, idempotencyKey);
        toast.success("Variant created.");
      }
      onSuccess();
    } catch (err) {
      const conflict = isConflict(err);
      setError(smsErrorMessage(err, conflict ? "A variant with the same name and colour already exists for this model." : "Failed to save variant."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-card shadow-xl">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold">{isEdit ? "Edit variant" : "Add variant"}</h2>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">Model</label>
              <select
                value={isEdit ? variant.modelId : modelId}
                onChange={(e) => !isEdit && setModelId(e.target.value)}
                disabled={isEdit}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:bg-muted disabled:text-muted-foreground"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Variant name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Standard"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Battery variant (optional)</label>
              <input
                type="text"
                value={batteryVariant}
                onChange={(e) => setBatteryVariant(e.target.value)}
                placeholder="e.g. 1.44 kWh"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Colour</label>
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                required
                placeholder="e.g. Black"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Hex colour (optional)</label>
              <input
                type="text"
                value={colorHex}
                onChange={(e) => setColorHex(e.target.value)}
                placeholder="#000000"
                pattern="^#[0-9A-Fa-f]{6}$"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              data-tour="sms-variant-save"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add variant"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

export default function MasterPage() {
  const { can, canGlobally } = useShowroom();
  const canManage = canGlobally(SMS_PERMISSIONS.MASTER_MANAGE) || can(SMS_PERMISSIONS.MASTER_MANAGE);

  const [models, setModels] = useState<VehicleModelRow[]>([]);
  const [variants, setVariants] = useState<VehicleVariantRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [variantsLoading, setVariantsLoading] = useState(true);
  const [modelFilter, setModelFilter] = useState<string>("");

  // Dialog state
  const [modelDialog, setModelDialog] = useState<VehicleModelRow | null | false>(false); // false = closed, null = create
  const [variantDialog, setVariantDialog] = useState<VehicleVariantRow | null | false>(false);

  // Toggle actions
  const [togglingModelId, setTogglingModelId] = useState<string | null>(null);
  const [togglingVariantId, setTogglingVariantId] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await apiGet<VehicleModelRow[]>("/api/sms/master/vehicle-models", { includeInactive: "true" });
      setModels(data);
    } catch {
      toast.error("Failed to load models.");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const fetchVariants = useCallback(async () => {
    setVariantsLoading(true);
    try {
      const data = await apiGet<VehicleVariantRow[]>("/api/sms/master/vehicle-variants", { includeInactive: "true" });
      setVariants(data);
    } catch {
      toast.error("Failed to load variants.");
    } finally {
      setVariantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchModels();
    void fetchVariants();
  }, [fetchModels, fetchVariants]);

  const handleToggleModel = async (model: VehicleModelRow) => {
    setTogglingModelId(model.id);
    try {
      const key = newIdempotencyKey();
      await smsPut(`/api/sms/master/vehicle-models/${model.id}`, { isActive: !model.isActive }, key);
      toast.success(`Model ${model.isActive ? "deactivated" : "activated"}.`);
      void fetchModels();
    } catch (err) {
      toast.error(smsErrorMessage(err, "Failed to update model."));
    } finally {
      setTogglingModelId(null);
    }
  };

  const handleToggleVariant = async (variant: VehicleVariantRow) => {
    setTogglingVariantId(variant.id);
    try {
      const key = newIdempotencyKey();
      await smsPut(`/api/sms/master/vehicle-variants/${variant.id}`, { isActive: !variant.isActive }, key);
      toast.success(`Variant ${variant.isActive ? "deactivated" : "activated"}.`);
      void fetchVariants();
    } catch (err) {
      toast.error(smsErrorMessage(err, "Failed to update variant."));
    } finally {
      setTogglingVariantId(null);
    }
  };

  const filteredVariants = modelFilter ? variants.filter((v) => v.modelId === modelFilter) : variants;

  return (
    <div className="p-4 md:p-6" data-tour="sms-master">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Product master</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Vehicle models and variants used across all showrooms.
        </p>
      </div>

      {/* Models section */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Models</h2>
          {canManage && (
            <button
              type="button"
              onClick={() => setModelDialog(null)}
              data-tour="sms-add-model"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add model
            </button>
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Code</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-right font-medium">Variants</th>
                <th className="px-4 py-3 text-right font-medium">Units</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                {canManage && <th className="px-4 py-3 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {modelsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: canManage ? 6 : 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : models.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                    No models yet.{canManage ? " Add one to get started." : ""}
                  </td>
                </tr>
              ) : (
                models.map((model) => (
                  <tr key={model.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 font-mono font-medium">{model.code}</td>
                    <td className="px-4 py-3">{model.name}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{model.variantCount}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{model.unitCount}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          model.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {model.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setModelDialog(model)}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={togglingModelId === model.id}
                          onClick={() => void handleToggleModel(model)}
                          className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        >
                          {model.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards for models */}
        <div className="space-y-2 md:hidden">
          {modelsLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : models.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No models yet.
            </div>
          ) : (
            models.map((model) => (
              <div key={model.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-semibold">{model.code}</span>
                    <span className="ml-2 text-sm">{model.name}</span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      model.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {model.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {model.variantCount} variants · {model.unitCount} units
                </div>
                {canManage && (
                  <div className="mt-2 flex gap-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => setModelDialog(model)}
                      className="rounded px-2 py-1 text-xs text-primary hover:bg-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={togglingModelId === model.id}
                      onClick={() => void handleToggleModel(model)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                    >
                      {model.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Variants section */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">Variants</h2>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All models</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setVariantDialog(null)}
              data-tour="sms-add-variant"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add variant
            </button>
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Variant</th>
                <th className="px-4 py-3 text-left font-medium">Battery variant</th>
                <th className="px-4 py-3 text-left font-medium">Colour</th>
                <th className="px-4 py-3 text-right font-medium">Units</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                {canManage && <th className="px-4 py-3 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {variantsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    {Array.from({ length: canManage ? 7 : 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredVariants.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    No variants found.{canManage ? " Add one to get started." : ""}
                  </td>
                </tr>
              ) : (
                filteredVariants.map((variant) => (
                  <tr key={variant.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground">{variant.model.name}</td>
                    <td className="px-4 py-3 font-medium">{variant.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{variant.batteryVariant ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {variant.colorHex && (
                          <span
                            className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border"
                            style={{ backgroundColor: variant.colorHex }}
                          />
                        )}
                        {variant.color}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{variant.unitCount}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          variant.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {variant.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setVariantDialog(variant)}
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={togglingVariantId === variant.id}
                          onClick={() => void handleToggleVariant(variant)}
                          className="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                        >
                          {variant.isActive ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards for variants */}
        <div className="space-y-2 md:hidden">
          {variantsLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : filteredVariants.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No variants found.
            </div>
          ) : (
            filteredVariants.map((variant) => (
              <div key={variant.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">{variant.model.name}</div>
                    <div className="font-medium">{variant.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {variant.colorHex && (
                        <span
                          className="inline-block h-3 w-3 rounded-full border"
                          style={{ backgroundColor: variant.colorHex }}
                        />
                      )}
                      {variant.color}
                      {variant.batteryVariant && <span>· {variant.batteryVariant}</span>}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      variant.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {variant.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                {canManage && (
                  <div className="mt-2 flex gap-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => setVariantDialog(variant)}
                      className="rounded px-2 py-1 text-xs text-primary hover:bg-accent"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={togglingVariantId === variant.id}
                      onClick={() => void handleToggleVariant(variant)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                    >
                      {variant.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Model dialog */}
      {modelDialog !== false && (
        <ModelFormDialog
          model={modelDialog}
          onClose={() => setModelDialog(false)}
          onSuccess={() => {
            setModelDialog(false);
            void fetchModels();
          }}
        />
      )}

      {/* Variant dialog */}
      {variantDialog !== false && (
        <VariantFormDialog
          variant={variantDialog}
          models={models.filter((m) => m.isActive)}
          defaultModelId={modelFilter || undefined}
          onClose={() => setVariantDialog(false)}
          onSuccess={() => {
            setVariantDialog(false);
            void fetchVariants();
          }}
        />
      )}
    </div>
  );
}
