// Phase 17 v2 — PO + Item amount math. Centralised here so the service,
// the future Odoo PDF importer (Tier 7.10), and the frontend (if it
// ever needs to preview pre-submit) all share the exact same formula.
//
// Decimal arithmetic uses Prisma's Decimal (decimal.js under the hood)
// so we don't drift from the schema's Decimal(15,2). Rounding policy:
// HALF_UP at 2 decimal places to match standard accounting practice
// and the spec's currency-formatted outputs.

import { Prisma } from '@prisma/client';

const TWO_DP = 2;
// Decimal.js rounding modes: 4 = ROUND_HALF_UP.
const ROUND_HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export interface ItemAmounts {
  untaxedAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

export interface ItemInput {
  qty: number;
  unitPrice: number | string | Prisma.Decimal;
  discountPercent?: number | string | Prisma.Decimal;
  taxPercent?: number | string | Prisma.Decimal;
}

/**
 * Compute the three denormalised amounts for a single PO/Batch line.
 *
 *   untaxed = qty × unitPrice × (1 − discount/100)
 *   tax     = untaxed × tax/100
 *   total   = untaxed + tax
 *
 * Tax is computed EXCLUSIVE (added on top of untaxed). Both inputs
 * (qty / unitPrice / percent fields) come from user input — the
 * service has already validated bounds + non-negativity at the Zod
 * layer.
 */
export function computeItemAmounts(item: ItemInput): ItemAmounts {
  const qty = new Prisma.Decimal(item.qty);
  const unitPrice = new Prisma.Decimal(item.unitPrice);
  const discountPct = new Prisma.Decimal(item.discountPercent ?? 0);
  const taxPct = new Prisma.Decimal(item.taxPercent ?? 0);

  const HUNDRED = new Prisma.Decimal(100);
  const ONE = new Prisma.Decimal(1);

  const discountFactor = ONE.sub(discountPct.div(HUNDRED));
  const taxFactor = taxPct.div(HUNDRED);

  const gross = qty.mul(unitPrice);
  const untaxed = gross.mul(discountFactor).toDecimalPlaces(TWO_DP, ROUND_HALF_UP);
  const tax = untaxed.mul(taxFactor).toDecimalPlaces(TWO_DP, ROUND_HALF_UP);
  const total = untaxed.add(tax).toDecimalPlaces(TWO_DP, ROUND_HALF_UP);

  return { untaxedAmount: untaxed, taxAmount: tax, totalAmount: total };
}

export interface PoTotals {
  untaxedAmount: Prisma.Decimal;
  totalTaxes: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

/**
 * Sum a list of already-computed item amounts into the three PO-level
 * totals. The denormalised columns on PurchaseOrder are written from
 * this output inside the same transaction that persists the items.
 */
export function sumPoTotals(items: ItemAmounts[]): PoTotals {
  let untaxed = new Prisma.Decimal(0);
  let tax = new Prisma.Decimal(0);
  for (const it of items) {
    untaxed = untaxed.add(it.untaxedAmount);
    tax = tax.add(it.taxAmount);
  }
  return {
    untaxedAmount: untaxed.toDecimalPlaces(TWO_DP, ROUND_HALF_UP),
    totalTaxes: tax.toDecimalPlaces(TWO_DP, ROUND_HALF_UP),
    totalAmount: untaxed.add(tax).toDecimalPlaces(TWO_DP, ROUND_HALF_UP),
  };
}
