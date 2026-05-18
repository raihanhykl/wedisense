import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createWorkbook, writeRowsToWorksheet } from '../../../lib/excel.js';
import { createReportPdf } from '../../../lib/report-pdf.js';
import type { ReportParameters } from '../types.js';

const EXCEL_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 22 },
  { header: 'Name', key: 'name', width: 30 },
  { header: 'Serial Number', key: 'serialNumber', width: 22 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Condition', key: 'condition', width: 14 },
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Location', key: 'location', width: 25 },
  { header: 'Assigned To', key: 'assignedTo', width: 25 },
  { header: 'Purchase Date', key: 'purchaseDate', width: 18 },
  { header: 'Purchase Price (IDR)', key: 'purchasePrice', width: 22 },
  { header: 'Current Book Value (IDR)', key: 'currentBookValue', width: 24 },
];

const PDF_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 2 },
  { header: 'Name', key: 'name', width: 3 },
  { header: 'Status', key: 'status', width: 1.5 },
  { header: 'Condition', key: 'condition', width: 1.5 },
  { header: 'Category', key: 'category', width: 2 },
  { header: 'Location', key: 'location', width: 2.5 },
  { header: 'Assigned To', key: 'assignedTo', width: 2 },
  { header: 'Purchase Date', key: 'purchaseDate', width: 1.5 },
  { header: 'Price (IDR)', key: 'purchasePrice', width: 2 },
  { header: 'Book Value (IDR)', key: 'currentBookValue', width: 2 },
];

export async function generateAssetListReport(
  parameters: ReportParameters,
  format: 'excel' | 'pdf',
): Promise<Buffer> {
  const where: Prisma.AssetWhereInput = { deletedAt: null };

  if (parameters['status']) {
    where.status = parameters['status'] as Prisma.EnumAssetStatusFilter;
  }
  // Single explicit filter the caller chose
  if (parameters['locationId']) {
    where.locationId = parameters['locationId'] as string;
  }
  // RBAC scope — caller (router) must inject this for location-scoped users.
  // When both are present, intersect by giving precedence to the explicit filter
  // only if it falls within scope; otherwise restrict to scope.
  const scope = parameters['locationIds'] as string[] | undefined;
  if (scope && scope.length > 0) {
    if (parameters['locationId']) {
      const requested = parameters['locationId'] as string;
      where.locationId = scope.includes(requested) ? requested : { in: [] };
    } else {
      where.locationId = { in: scope };
    }
  }
  if (parameters['categoryId']) {
    where.product = { categoryId: parameters['categoryId'] as string };
  }
  if (parameters['purchaseDateFrom'] || parameters['purchaseDateTo']) {
    const dateFilter: Prisma.DateTimeNullableFilter = {};
    if (parameters['purchaseDateFrom']) {
      dateFilter.gte = new Date(parameters['purchaseDateFrom'] as string);
    }
    if (parameters['purchaseDateTo']) {
      dateFilter.lte = new Date(parameters['purchaseDateTo'] as string);
    }
    where.purchaseDate = dateFilter;
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: { assetNumber: 'asc' },
    include: {
      product: { include: { category: { select: { id: true, name: true } } } },
      location: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  const rows: Record<string, unknown>[] = assets.map((a) => ({
    assetNumber: a.assetNumber,
    name: a.name,
    serialNumber: a.serialNumber ?? '',
    status: a.status,
    condition: a.condition,
    category: a.product.category.name,
    location: a.location.name,
    assignedTo: a.assignedTo?.name ?? '',
    purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString().split('T')[0] : '',
    purchasePrice: a.purchasePrice ? Number(a.purchasePrice).toLocaleString('id-ID') : '',
    currentBookValue: a.currentBookValue ? Number(a.currentBookValue).toLocaleString('id-ID') : '',
  }));

  if (format === 'pdf') {
    return createReportPdf({
      title: 'Asset List Report',
      subtitle: `Total: ${rows.length} assets`,
      columns: PDF_COLUMNS,
      rows,
      metadata: {
        'Generated': new Date().toISOString().split('T')[0] ?? '',
        'Total Assets': String(rows.length),
      },
    });
  }

  // Excel format
  const wb = createWorkbook();
  const ws = wb.addWorksheet('Asset List', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRowsToWorksheet(ws, EXCEL_COLUMNS, rows);

  // Summary row
  const summaryRow = ws.addRow({});
  ws.getCell(`A${summaryRow.number}`).value = `Total: ${rows.length} assets`;
  ws.getCell(`A${summaryRow.number}`).font = { bold: true, italic: true };

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: EXCEL_COLUMNS.length },
  };

  // ExcelJS Buffer is not Node Buffer; cast required to bridge type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}
