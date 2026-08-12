"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import ProtectedRoute from "@/components/shared/protected-route";
import Breadcrumb from "@/components/shared/breadcrumb";
import { apiGet, apiPostForm, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { usePermission } from "@/hooks/use-permission";
import type { CompanySetting } from "@/types/admin";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "";

const LOGO_MAX_MB = 2;

type FormState = Omit<CompanySetting, "id" | "logoUrl">;

const EMPTY: FormState = {
  name: "",
  address: null,
  city: null,
  province: null,
  postalCode: null,
  phone: null,
  email: null,
  website: null,
  documentCode: "WDS",
  divisionCode: "IT",
};

function CompanySettingsContent() {
  const canManage = usePermission("settings:manage");

  const [form, setForm] = useState<FormState>(EMPTY);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const applySetting = useCallback((setting: CompanySetting) => {
    // `id` and `logoUrl` are tracked outside the editable form state: the id
    // is never sent back, and the logo is changed through its own upload
    // endpoint rather than the main save.
    setLogoUrl(setting.logoUrl);
    setForm({
      name: setting.name,
      address: setting.address,
      city: setting.city,
      province: setting.province,
      postalCode: setting.postalCode,
      phone: setting.phone,
      email: setting.email,
      website: setting.website,
      documentCode: setting.documentCode,
      divisionCode: setting.divisionCode,
    });
  }, []);

  const fetchSetting = useCallback(async () => {
    setLoading(true);
    try {
      applySetting(await apiGet<CompanySetting>("/api/settings/company"));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to load company settings"));
    } finally {
      setLoading(false);
    }
  }, [applySetting]);

  useEffect(() => {
    void fetchSetting();
  }, [fetchSetting]);

  const setField = (key: keyof FormState, value: string) => {
    // Empty inputs are sent as null so the server doesn't have to treat ""
    // and null as separate "unset" states.
    setForm((prev) => ({ ...prev, [key]: value === "" ? null : value }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Company name is required — it prints on every document.");
      return;
    }
    setSaving(true);
    try {
      applySetting(await apiPut<CompanySetting>("/api/settings/company", form));
      toast.success("Company settings saved");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to save company settings"));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires change.
    e.target.value = "";
    if (!file) return;

    if (file.size > LOGO_MAX_MB * 1024 * 1024) {
      toast.error(`Logo must be smaller than ${LOGO_MAX_MB} MB.`);
      return;
    }

    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      applySetting(await apiPostForm<CompanySetting>("/api/settings/company/logo", data));
      toast.success("Logo updated");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to upload logo"));
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="p-6">
      <Breadcrumb items={[{ label: "Settings" }, { label: "Company" }]} />

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Company</h1>
        <p className="text-sm text-muted-foreground">
          Identity printed on the letterhead of generated documents, and the
          codes used to build handover form numbers.
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* ── Logo ── */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Letterhead logo</h2>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${API_URL}${logoUrl}`}
                  alt="Company logo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="text-sm">
              <button
                type="button"
                disabled={!canManage || uploading}
                onClick={() => logoInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {logoUrl ? "Replace logo" : "Upload logo"}
              </button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                PNG or JPEG, up to {LOGO_MAX_MB} MB. Drawn at roughly 18 × 18 mm
                on the document, so a square mark reads best.
              </p>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleLogoSelected}
              className="hidden"
            />
          </div>
        </section>

        {/* ── Identity ── */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Identity</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Company name"
              required
              value={form.name}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))}
              disabled={!canManage}
              className="sm:col-span-2"
            />
            <Field
              label="Address"
              value={form.address ?? ""}
              onChange={(v) => setField("address", v)}
              disabled={!canManage}
              className="sm:col-span-2"
            />
            <Field
              label="City"
              value={form.city ?? ""}
              onChange={(v) => setField("city", v)}
              disabled={!canManage}
            />
            <Field
              label="Province"
              value={form.province ?? ""}
              onChange={(v) => setField("province", v)}
              disabled={!canManage}
            />
            <Field
              label="Postal code"
              value={form.postalCode ?? ""}
              onChange={(v) => setField("postalCode", v)}
              disabled={!canManage}
            />
            <Field
              label="Phone"
              value={form.phone ?? ""}
              onChange={(v) => setField("phone", v)}
              disabled={!canManage}
            />
            <Field
              label="Email"
              type="email"
              value={form.email ?? ""}
              onChange={(v) => setField("email", v)}
              disabled={!canManage}
            />
            <Field
              label="Website"
              value={form.website ?? ""}
              onChange={(v) => setField("website", v)}
              disabled={!canManage}
            />
          </div>
        </section>

        {/* ── Document numbering ── */}
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Document numbering</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These two codes are substituted into every handover form number.
            Changing them affects newly created forms only — numbers already
            issued are never rewritten.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field
              label="Division code"
              value={form.divisionCode}
              onChange={(v) => setForm((p) => ({ ...p, divisionCode: v.toUpperCase() }))}
              disabled={!canManage}
              hint="Letters and digits only"
            />
            <Field
              label="Company code"
              value={form.documentCode}
              onChange={(v) => setForm((p) => ({ ...p, documentCode: v.toUpperCase() }))}
              disabled={!canManage}
              hint="Letters and digits only"
            />
          </div>
          <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 font-mono text-sm">
            001/BAST-{form.divisionCode || "…"}/{form.documentCode || "…"}/VIII/
            {new Date().getFullYear()}
          </p>
        </section>

        {canManage && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  required,
  type = "text",
  hint,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  type?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function CompanySettingsPage() {
  return (
    <ProtectedRoute>
      <CompanySettingsContent />
    </ProtectedRoute>
  );
}
