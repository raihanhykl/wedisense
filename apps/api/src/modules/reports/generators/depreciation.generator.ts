import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createWorkbook, writeRowsToWorksheet } from '../../../lib/excel.js';
import { createReportPdf } from '../../../lib/report-pdf.js';
import type { ReportParameters } from '../types.js';

const EXCEL_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 22 },
  { header: 'Name', key: 'name', width: 28 },
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Purchase Date', key: 'purchaseDate', width: 18 },
  { header: 'Purchase Price (IDR)', key: 'purchasePrice', width: 22 },
  { header: 'Current Book Value (IDR)', key: 'currentBookValue', width: 24 },
  { header: 'Depreciation Amount (IDR)', key: 'depreciationAmount', width: 26 },
  { header: 'Depreciation %', key: 'depreciationPercent', width: 18 },
  { header: 'Useful Life (months)', key: 'usefulLifeMonths', width: 22 },
  { header: 'Months Elapsed', key: 'monthsElapsed', width: 18 },
];

const PDF_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 2 },
  { header: 'Name', key: 'name', width: 3 },
  { header: 'Category', key: 'category', width: 2 },
  { header: 'Purchase Price', key: 'purchasePrice', width: 2 },
  { header: 'Book Value', key: 'currentBookValue', width: 2 },
  { header: 'Depreciation', key: 'depreciationAmount', width: 2 },
  { header: 'Dep. %', key: 'depreciationPercent', width: 1.5 },
  { header: 'Useful Life', key: 'usefulLifeMonths', width: 1.5 },
  { header: 'Months Elapsed', key: 'monthsElapsed', width: 1.5 },
];

function calcMonthsElapsed(purchaseDate: Date | null): number {
  if (!purchaseDate) return 0;
  const now = new Date();
  return (
    (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
    (now.getMonth() - purchaseDate.getMonth())
  );
}

export async function generateDepreciationReport(
  parameters: ReportParameters,
  format: 'excel' | 'pdf',
): Promise<Buffer> {
  const where: Prisma.AssetWhereInput = {
    deletedAt: null,
    status: { not: 'DISPOSED' },
  };

  if (parameters['locationId']) {
    where.locationId = parameters['locationId'] as string;
  }
  if (parameters['categoryId']) {
    where.product = { categoryId: parameters['categoryId'] as string };
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: { assetNumber: 'asc' },
    include: {
      product: { include: { category: { select: { name: true } } } },
    },
  });

  const rows: Record<string, unknown>[] = assets.map((a) => {
    const price = a.purchasePrice ? Number(a.purchasePrice) : 0;
    const bookValue = a.currentBookValue ? Number(a.currentBookValue) : price;
    const depAmount = price - bookValue;
    const depPercent = price > 0 ? Math.round((depAmount / price) * 10000) / 100 : 0;
    const monthsElapsed = calcMonthsElapsed(a.purchaseDate);

    return {
      assetNumber: a.assetNumber,
      name: a.name,
      category: a.product.category.name,
      status: a.status,
      purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString().split('T')[0] : '',
      purchasePrice: price.toLocaleString('id-ID'),
      currentBookValue: bookValue.toLocaleString('id-ID'),
      depreciationAmount: depAmount.toLocaleString('id-ID'),
      depreciationPercent: `${depPercent}%`,
      usefulLifeMonths: a.usefulLifeMonths ?? '',
      monthsElapsed,
    };
  });

  const totalPurchasePrice = assets.reduce(
    (s, a) => s + (a.purchasePrice ? Number(a.purchasePrice) : 0),
    0,
  );
  const totalBookValue = assets.reduce(
    (s, a) => s + (a.currentBookValue
      ? Number(a.currentBookValue)
      : (a.purchasePrice ? Number(a.purchasePrice) : 0)),
    0,
  );
  const totalDepreciation = totalPurchasePrice - totalBookValue;

  if (format === 'pdf') {
    return createReportPdf({
      title: 'Depreciation Report',
      subtitle: `Total assets: ${rows.length}`,
      columns: PDF_COLUMNS,
      rows,
      metadata: {
        'Total Purchase Value': `IDR ${totalPurchasePrice.toLocaleString('id-ID')}`,
        'Total Book Value': `IDR ${totalBookValue.toLocaleString('id-ID')}`,
        'Total Depreciation': `IDR ${totalDepreciation.toLocaleString('id-ID')}`,
      },
    });
  }

  const wb = createWorkbook();
  const ws = wb.addWorksheet('Depreciation', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRowsToWorksheet(ws, EXCEL_COLUMNS, rows);

  // Summary rows
  const blankRow = ws.addRow({});
  void blankRow;

  const summaryData: Array<[string, string]> = [
    ['Total Purchase Value (IDR)', totalPurchasePrice.toLocaleString('id-ID')],
    ['Total Book Value (IDR)', totalBookValue.toLocaleString('id-ID')],
    ['Total Depreciation (IDR)', totalDepreciation.toLocaleString('id-ID')],
  ];
  for (const [label, value] of summaryData) {
    const r = ws.addRow({});
    ws.getCell(`A${r.number}`).value = label;
    ws.getCell(`A${r.number}`).font = { bold: true };
    ws.getCell(`B${r.number}`).value = value;
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: EXCEL_COLUMNS.length },
  };

  // ExcelJS Buffer is not Node Buffer; cast required to bridge type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}
