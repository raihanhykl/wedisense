import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildUnitPriceMap,
  resolveAssetFinancials,
  buildFinancialBackfillPatch,
  type BatchFinancialDefaults,
} from './asset-financials.js';

const D = (v: string | number) => new Prisma.Decimal(v);

const defaults: BatchFinancialDefaults = {
  batchId: 'batch-1',
  purchaseDate: new Date('2026-03-01T00:00:00Z'),
  currency: 'IDR',
  vendorId: 'vendor-1',
  invoiceNumber: 'INV-001',
  unitPriceByProductId: new Map([['prod-a', D('11100000.00')]]),
};

describe('buildUnitPriceMap()', () => {
  it('divides the line total (incl. discount + tax) by qty, 2dp half-up', () => {
    const map = buildUnitPriceMap([
      { productId: 'p', qty: 3, totalAmount: D('100.00') },
    ]);
    expect(map.get('p')?.toString()).toBe('33.33');
  });

  it('keeps the first line when a product appears twice', () => {
    const map = buildUnitPriceMap([
      { productId: 'p', qty: 1, totalAmount: D('10') },
      { productId: 'p', qty: 1, totalAmount: D('20') },
    ]);
    expect(map.get('p')?.toString()).toBe('10');
  });

  it('ignores zero-qty lines instead of dividing by zero', () => {
    const map = buildUnitPriceMap([{ productId: 'p', qty: 0, totalAmount: D('10') }]);
    expect(map.has('p')).toBe(false);
  });
});

describe('resolveAssetFinancials()', () => {
  it('passes explicit values through untouched when there is no batch', () => {
    const r = resolveAssetFinancials(
      { purchasePrice: 5, currency: 'USD', vendorId: 'v', invoiceNumber: 'i' },
      null,
      'prod-a',
    );
    expect(r.purchasePrice?.toString()).toBe('5');
    expect(r.currency).toBe('USD');
    expect(r.vendorId).toBe('v');
    expect(r.invoiceNumber).toBe('i');
    expect(r.purchaseDate).toBeNull();
  });

  it('fills every empty field from the batch', () => {
    const r = resolveAssetFinancials({}, defaults, 'prod-a');
    expect(r.purchaseDate).toEqual(defaults.purchaseDate);
    expect(r.purchasePrice?.toString()).toBe('11100000');
    expect(r.vendorId).toBe('vendor-1');
    expect(r.invoiceNumber).toBe('INV-001');
    expect(r.currency).toBe('IDR');
  });

  it('lets explicit client values win over the batch', () => {
    const r = resolveAssetFinancials(
      { purchasePrice: 1, vendorId: 'other', invoiceNumber: 'X' },
      defaults,
      'prod-a',
    );
    expect(r.purchasePrice?.toString()).toBe('1');
    expect(r.vendorId).toBe('other');
    expect(r.invoiceNumber).toBe('X');
  });

  it('leaves the price empty for a product the PO does not list', () => {
    const r = resolveAssetFinancials({}, defaults, 'prod-unknown');
    expect(r.purchasePrice).toBeNull();
    // ...but still inherits the batch-level facts.
    expect(r.vendorId).toBe('vendor-1');
  });
});

describe('buildFinancialBackfillPatch()', () => {
  it('only touches NULL fields', () => {
    const patch = buildFinancialBackfillPatch(
      {
        productId: 'prod-a',
        purchaseDate: new Date('2020-01-01'),
        purchasePrice: D('1'),
        vendorId: null,
        invoiceNumber: null,
      },
      defaults,
    );
    expect(patch).toEqual({ vendorId: 'vendor-1', invoiceNumber: 'INV-001' });
  });

  it('returns null when nothing is missing', () => {
    const patch = buildFinancialBackfillPatch(
      {
        productId: 'prod-a',
        purchaseDate: new Date('2020-01-01'),
        purchasePrice: D('1'),
        vendorId: 'v',
        invoiceNumber: 'i',
      },
      defaults,
    );
    expect(patch).toBeNull();
  });

  it('does not write a NULL vendor/invoice when the batch has none either', () => {
    const patch = buildFinancialBackfillPatch(
      { productId: 'prod-a', purchaseDate: null, purchasePrice: null, vendorId: null, invoiceNumber: null },
      { ...defaults, vendorId: null, invoiceNumber: null },
    );
    expect(patch).toEqual({
      purchaseDate: defaults.purchaseDate,
      purchasePrice: D('11100000.00'),
    });
  });
});
