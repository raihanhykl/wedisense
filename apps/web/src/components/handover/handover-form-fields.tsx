"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiPut } from "@/lib/api";
import { getApiErrorMessage } from "@/lib/error";
import { useLocations, useUsers } from "@/hooks/use-reference-data";
import {
  HANDOVER_TYPE_DESCRIPTIONS,
  HANDOVER_TYPE_LABELS,
  partyRequirements,
} from "@/lib/handover";
import HandoverAssetPicker, { type PickedAsset } from "./handover-asset-picker";
import type { HandoverFormDetail, HandoverType } from "@/types/admin";

const HANDOVER_TYPES: HandoverType[] = [
  "COMPANY_TO_EMPLOYEE",
  "EMPLOYEE_TO_EMPLOYEE",
  "EMPLOYEE_TO_COMPANY",
];

interface HandoverFormFieldsProps {
  /** Present when editing an existing draft; absent when creating. */
  existing?: HandoverFormDetail;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function HandoverFormFields({ existing }: HandoverFormFieldsProps) {
  const router = useRouter();
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const { data: locations = [] } = useLocations();

  const [handoverType, setHandoverType] = useState<HandoverType>(
    existing?.handoverType ?? "COMPANY_TO_EMPLOYEE",
  );
  const [handoverDate, setHandoverDate] = useState(
    existing ? existing.handoverDate.slice(0, 10) : todayIso(),
  );
  const [itOfficerUserId, setItOfficerUserId] = useState(existing?.itOfficer?.id ?? "");
  const [fromUserId, setFromUserId] = useState(existing?.fromUser?.id ?? "");
  const [toUserId, setToUserId] = useState(existing?.toUser?.id ?? "");
  const [acknowledgedByUserId, setAcknowledgedByUserId] = useState(
    existing?.acknowledgedBy?.id ?? "",
  );
  const [fromLocationId, setFromLocationId] = useState(existing?.fromLocation?.id ?? "");
  const [toLocationId, setToLocationId] = useState(existing?.toLocation?.id ?? "");
  const [purpose, setPurpose] = useState(existing?.purpose ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [items, setItems] = useState<PickedAsset[]>(
    existing
      ? existing.items.map((item) => ({
          assetId: item.assetId,
          assetNumber: item.assetNumber,
          assetName: item.assetName,
          serialNumber: item.serialNumber,
          condition: item.condition,
          itemNotes: item.itemNotes ?? "",
        }))
      : [],
  );
  const [saving, setSaving] = useState(false);

  const { needsFromUser, needsToUser } = partyRequirements(handoverType);

  // Clearing the party the new direction doesn't use keeps the client in step
  // with the server's rule that the unused side must be absent — otherwise a
  // stale value silently 422s on submit.
  useEffect(() => {
    if (!needsFromUser && fromUserId) setFromUserId("");
    if (!needsToUser && toUserId) setToUserId("");
  }, [needsFromUser, needsToUser, fromUserId, toUserId]);

  const fromUserName = useMemo(
    () => users.find((u) => u.id === fromUserId)?.name ?? null,
    [users, fromUserId],
  );

  const validate = (): string | null => {
    if (!itOfficerUserId) return "Select the IT officer running this handover.";
    if (needsFromUser && !fromUserId) return "Select the employee handing the assets over.";
    if (needsToUser && !toUserId) return "Select the employee receiving the assets.";
    if (needsFromUser && needsToUser && fromUserId === toUserId) {
      return "The handing-over and receiving employees must be different people.";
    }
    if (items.length === 0) return "Add at least one asset to the form.";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }

    const payload = {
      handoverType,
      handoverDate,
      itOfficerUserId,
      fromUserId: needsFromUser ? fromUserId : null,
      toUserId: needsToUser ? toUserId : null,
      acknowledgedByUserId: acknowledgedByUserId || null,
      fromLocationId: fromLocationId || null,
      toLocationId: toLocationId || null,
      purpose: purpose.trim() || null,
      notes: notes.trim() || null,
      items: items.map((item) => ({
        assetId: item.assetId,
        itemNotes: item.itemNotes.trim() || null,
      })),
    };

    setSaving(true);
    try {
      const saved = existing
        ? await apiPut<HandoverFormDetail>(`/api/handover-forms/${existing.id}`, payload)
        : await apiPost<HandoverFormDetail>("/api/handover-forms", payload);
      toast.success(
        existing ? "Handover form updated" : `Handover form created — ${saved.formNumber}`,
      );
      router.push(`/admin/handover-forms/${saved.id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to save the handover form"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-tour="handover-form">
      {/* ── Transaction ── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Transaction</h2>

        <div className="grid gap-3 sm:grid-cols-3">
          {HANDOVER_TYPES.map((type) => (
            <label
              key={type}
              className={`cursor-pointer rounded-md border p-3 text-sm transition-colors ${
                handoverType === type
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/40"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="handoverType"
                  value={type}
                  checked={handoverType === type}
                  onChange={() => setHandoverType(type)}
                />
                {HANDOVER_TYPE_LABELS[type]}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {HANDOVER_TYPE_DESCRIPTIONS[type]}
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label required>Handover date</Label>
            <input
              type="date"
              value={handoverDate}
              onChange={(e) => setHandoverDate(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Also decides which year the form number is sequenced under.
            </p>
          </div>
          <div>
            <Label>Purpose</Label>
            <input
              type="text"
              value={purpose}
              maxLength={500}
              placeholder="e.g. Mutasi karyawan antar cabang"
              onChange={(e) => setPurpose(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      </section>

      {/* ── Parties ── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Parties</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Names and employee IDs are frozen onto the form when it is saved, so
          the printed document keeps naming whoever actually signed it.
        </p>

        {usersLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <UserSelect
              label="IT officer"
              required
              value={itOfficerUserId}
              onChange={setItOfficerUserId}
              users={users}
              hint="Signs the “Petugas IT” block."
            />
            <UserSelect
              label="Acknowledged by"
              value={acknowledgedByUserId}
              onChange={setAcknowledgedByUserId}
              users={users}
              hint="Optional. Left blank, the “Mengetahui” block prints an empty line to sign by hand."
            />

            {needsFromUser && (
              <UserSelect
                label="Handing over (employee)"
                required
                value={fromUserId}
                onChange={setFromUserId}
                users={users}
              />
            )}
            {needsToUser && (
              <UserSelect
                label="Receiving (employee)"
                required
                value={toUserId}
                onChange={setToUserId}
                users={users}
              />
            )}

            <LocationSelect
              label="From location"
              value={fromLocationId}
              onChange={setFromLocationId}
              locations={locations}
            />
            <LocationSelect
              label="To location"
              value={toLocationId}
              onChange={setToLocationId}
              locations={locations}
            />
          </div>
        )}
      </section>

      {/* ── Assets ── */}
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Assets</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Each asset&apos;s condition is snapshotted when the form is saved —
          that is what the receiver signs for.
        </p>
        <HandoverAssetPicker
          value={items}
          onChange={setItems}
          bulkFromUserId={needsFromUser ? fromUserId || null : null}
          bulkFromUserName={fromUserName}
        />
      </section>

      {/* ── Notes ── */}
      <section className="rounded-lg border bg-card p-4">
        <Label>Notes</Label>
        <textarea
          value={notes}
          maxLength={2000}
          rows={3}
          placeholder="Anything that should appear on the printed document."
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted/50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {existing ? "Save changes" : "Create draft"}
        </button>
      </div>
    </form>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function UserSelect({
  label,
  value,
  onChange,
  users,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  users: Array<{ id: string; name: string; email: string }>;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">— none —</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({user.email})
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function LocationSelect({
  label,
  value,
  onChange,
  locations,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  locations: Array<{ id: string; name: string }>;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">— none —</option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>
    </div>
  );
}
