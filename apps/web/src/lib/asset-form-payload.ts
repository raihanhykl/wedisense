import type { AssetFormData } from "@/types/admin";

/**
 * Convert the raw AssetForm string values into the shape the API Zod schema
 * accepts. The form keeps every field as a string (React's controlled-input
 * convention); the backend expects numbers, dates and nulls. Sending an empty
 * string where the schema asks for a number raises a ZodError which surfaces
 * as a 500 to the user — this helper closes that gap.
 *
 * Rules:
 *  - empty string ("") → null (the schema treats null as "no value")
 *  - numeric strings → Number (NaN guarded against — invalid input still goes
 *    through as null so the user sees a friendly validation message rather
 *    than a server crash)
 *  - date strings → kept as-is (the backend uses `z.coerce.date()`, which
 *    accepts ISO date strings)
 */
export function assetFormToApiPayload(form: AssetFormData): Record<string, unknown> {
  return {
    productId: form.productId,
    name: form.name,
    locationId: form.locationId,
    status: form.status,
    condition: form.condition,
    // Nullable string fields — empty string is "no value".
    serialNumber: form.serialNumber.trim() === "" ? null : form.serialNumber.trim(),
    assignedToUserId:
      form.assignedToUserId.trim() === "" ? null : form.assignedToUserId.trim(),
    vendor: form.vendor.trim() === "" ? null : form.vendor.trim(),
    invoiceNumber:
      form.invoiceNumber.trim() === "" ? null : form.invoiceNumber.trim(),
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    // Nullable date fields.
    purchaseDate: form.purchaseDate === "" ? null : form.purchaseDate,
    warrantyStartDate:
      form.warrantyStartDate === "" ? null : form.warrantyStartDate,
    warrantyEndDate: form.warrantyEndDate === "" ? null : form.warrantyEndDate,
    // Nullable numeric fields.
    purchasePrice: toNullableNumber(form.purchasePrice),
    usefulLifeMonths: toNullableInt(form.usefulLifeMonths),
  };
}

function toNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function toNullableInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}
