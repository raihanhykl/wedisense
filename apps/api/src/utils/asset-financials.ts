import { Prisma } from '@prisma/client';

/**
 * Financial facts an asset inherits from the procurement batch (and its
 * parent purchase order) it was received under. Loaded once per batch by
 * `loadBatchFinancialDefaults()` in the procurement-batches service and
 * applied per asset by the pure helpers below.
 *
 * Why inherit at all: before this existed, assets added through the
 * "Add Assets" page of a batch were created with only name/serial/product/
 * location — purchase date, price, vendor and invoice stayed NULL even
 * though the PO already knew every one of them. The asset detail page then
 * showed "-" in the Financial card for exactly the assets whose provenance
 * was best documented.
 */
export interface BatchFinancialDefaults {
  batchId: string;
  purchaseDate: Date;
  currency: string;
  vendorId: string | null;
  invoiceNumber: string | null;
  /**
   * Per-unit landed price keyed by productId: PO line `totalAmount ÷ qty`,
   * i.e. AFTER line discount and tax. That is what the company actually
   * paid per unit, which is the acquisition cost depreciation runs from.
   * When a PO lists the same product on several lines, the first line (by
   * sortOrder) wins — a deliberate, documented tie-break rather than an
   * average that matches no invoice line.
   */
  unitPriceByProductId: ReadonlyMap<string, Prisma.Decimal>;
}

/** The subset of asset financial fields the batch can provide. */
export interface AssetFinancialFields {
  purchaseDate: Date | null;
  purchasePrice: Prisma.Decimal | null;
  currency: string;
  vendorId: string | null;
  invoiceNumber: string | null;
}

export interface ExplicitFinancialInput {
  purchaseDate?: Date | null;
  purchasePrice?: number | null;
  currency?: string | null;
  vendorId?: string | null;
  invoiceNumber?: string | null;
}

/**
 * Build the per-product unit price map from raw PO lines. Exported so the
 * loader and the unit tests share one definition of "unit price".
 */
export function buildUnitPriceMap(
  lines: ReadonlyArray<{ productId: string; qty: number; totalAmount: Prisma.Decimal }>,
): Map<string, Prisma.Decimal> {
  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    if (map.has(line.productId)) continue;
    if (line.qty <= 0) continue;
    map.set(
      line.productId,
      new Prisma.Decimal(line.totalAmount)
        .div(line.qty)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    );
  }
  return map;
}

/**
 * Resolve the financial fields for a NEW asset. Explicit client values
 * always win; the batch only fills what the client left empty. Currency is
 * the one exception: for a batch-linked asset the PO currency is
 * authoritative, because the Zod schema defaults `currency` to 'IDR' and a
 * caller cannot express "I didn't say".
 */
export function resolveAssetFinancials(
  explicit: ExplicitFinancialInput,
  defaults: BatchFinancialDefaults | null,
  productId: string,
): AssetFinancialFields {
  const explicitPrice =
    explicit.purchasePrice != null ? new Prisma.Decimal(explicit.purchasePrice) : null;

  if (!defaults) {
    return {
      purchaseDate: explicit.purchaseDate ?? null,
      purchasePrice: explicitPrice,
      currency: explicit.currency ?? 'IDR',
      vendorId: explicit.vendorId ?? null,
      invoiceNumber: explicit.invoiceNumber ?? null,
    };
  }

  return {
    purchaseDate: explicit.purchaseDate ?? defaults.purchaseDate,
    purchasePrice: explicitPrice ?? defaults.unitPriceByProductId.get(productId) ?? null,
    currency: defaults.currency,
    vendorId: explicit.vendorId ?? defaults.vendorId,
    invoiceNumber: explicit.invoiceNumber ?? defaults.invoiceNumber,
  };
}

/** Existing asset row shape the backfill needs. */
export interface ExistingAssetFinancials {
  productId: string;
  purchaseDate: Date | null;
  purchasePrice: Prisma.Decimal | null;
  vendorId: string | null;
  invoiceNumber: string | null;
}

export type FinancialBackfillPatch = Partial<
  Pick<AssetFinancialFields, 'purchaseDate' | 'purchasePrice' | 'vendorId' | 'invoiceNumber'>
>;

/**
 * Build the UPDATE patch for an EXISTING asset: only fields that are
 * currently NULL and for which the batch has a value. Never overwrites a
 * value an operator entered by hand — the sync is a gap-filler, not a
 * reset. Returns null when there is nothing to do, so callers can skip
 * the write (and the audit row) entirely.
 */
export function buildFinancialBackfillPatch(
  asset: ExistingAssetFinancials,
  defaults: BatchFinancialDefaults,
): FinancialBackfillPatch | null {
  const patch: FinancialBackfillPatch = {};

  if (asset.purchaseDate === null) {
    patch.purchaseDate = defaults.purchaseDate;
  }
  if (asset.purchasePrice === null) {
    const unit = defaults.unitPriceByProductId.get(asset.productId);
    if (unit !== undefined) patch.purchasePrice = unit;
  }
  if (asset.vendorId === null && defaults.vendorId !== null) {
    patch.vendorId = defaults.vendorId;
  }
  if (asset.invoiceNumber === null && defaults.invoiceNumber !== null) {
    patch.invoiceNumber = defaults.invoiceNumber;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
