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
  { header: 'Purchase Price', key: 'purchasePrice', width: 22 },
  { header: 'Current Book Value', key: 'currentBookValue', width: 24 },
];

// Excel/LibreOffice render the rupiah symbol with thousand-grouping by period
// when the workbook locale is `id_ID`. We force the format on the cells so
// the file looks correct regardless of the recipient's locale.
const IDR_NUM_FMT = '"Rp" #,##0;[Red]-"Rp" #,##0';
const DATE_FMT = 'yyyy-mm-dd';

// Hard cap on rows we will pull into memory for a single export. The sync
// path already gates by ASYNC_ROW_THRESHOLD=5000 at the router; this cap is
// the safety net for the async/scheduled paths that don't have that gate.
// 50,000 ≈ 25-40MB of structured data — survivable in a Node.js worker
// without hitting OOM on a default 512MB heap. Beyond that, the report
// system should switch to a streaming exporter.
const MAX_EXPORT_ROWS = 50_000;

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
  if (parameters['assignedToUserId']) {
    where.assignedToUserId = parameters['assignedToUserId'] as string;
  }
  if (parameters['condition']) {
    where.condition = parameters['condition'] as Prisma.EnumAssetConditionFilter;
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
  if (parameters['search']) {
    const term = parameters['search'] as string;
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { assetNumber: { contains: term, mode: 'insensitive' } },
      { serialNumber: { contains: term, mode: 'insensitive' } },
    ];
  }

  // Defensive cap: pull at most MAX_EXPORT_ROWS + 1 so we can detect overflow
  // without a separate count query. If the take limit fills, refuse the
  // export rather than silently truncating.
  const assets = await prisma.asset.findMany({
    where,
    orderBy: { assetNumber: 'asc' },
    take: MAX_EXPORT_ROWS + 1,
    include: {
      product: { include: { category: { select: { id: true, name: true } } } },
      location: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  if (assets.length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Export exceeds the ${MAX_EXPORT_ROWS}-row cap. Narrow the filters or run multiple smaller exports.`,
    );
  }

  if (format === 'pdf') {
    // PDF cells render via String(val); pre-format dates and currency so the
    // recipient sees "Rp 1.500.000" and "2024-01-15" instead of empty cells.
    const idrPdf = new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const pdfRows: Record<string, unknown>[] = assets.map((a) => ({
      assetNumber: a.assetNumber,
      name: a.name,
      serialNumber: a.serialNumber ?? '',
      status: a.status,
      condition: a.condition,
      category: a.product.category.name,
      location: a.location.name,
      assignedTo: a.assignedTo?.name ?? '',
      purchaseDate: a.purchaseDate ? a.purchaseDate.toISOString().split('T')[0] : '',
      purchasePrice: a.purchasePrice ? idrPdf.format(Number(a.purchasePrice)) : '',
      currentBookValue: a.currentBookValue ? idrPdf.format(Number(a.currentBookValue)) : '',
    }));

    return createReportPdf({
      title: 'Asset List Report',
      subtitle: `Total: ${pdfRows.length} assets`,
      columns: PDF_COLUMNS,
      rows: pdfRows,
      metadata: {
        'Generated': new Date().toISOString().split('T')[0] ?? '',
        'Total Assets': String(pdfRows.length),
      },
    });
  }

  // Excel format — preserve raw types so Excel-side filters and totals work.
  const xlsxRows: Record<string, unknown>[] = assets.map((a) => ({
    assetNumber: a.assetNumber,
    name: a.name,
    serialNumber: a.serialNumber ?? '',
    status: a.status,
    condition: a.condition,
    category: a.product.category.name,
    location: a.location.name,
    assignedTo: a.assignedTo?.name ?? '',
    purchaseDate: a.purchaseDate ?? null,
    purchasePrice: a.purchasePrice != null ? Number(a.purchasePrice) : null,
    currentBookValue: a.currentBookValue != null ? Number(a.currentBookValue) : null,
  }));

  const wb = createWorkbook();
  const ws = wb.addWorksheet('Asset List', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRowsToWorksheet(ws, EXCEL_COLUMNS, xlsxRows);

  // Apply IDR currency format to the price columns and an ISO date format to
  // the purchase date column. ExcelJS columns are 1-indexed.
  const purchaseDateCol = ws.getColumn(EXCEL_COLUMNS.findIndex((c) => c.key === 'purchaseDate') + 1);
  purchaseDateCol.numFmt = DATE_FMT;
  const priceCol = ws.getColumn(EXCEL_COLUMNS.findIndex((c) => c.key === 'purchasePrice') + 1);
  priceCol.numFmt = IDR_NUM_FMT;
  const bookValueCol = ws.getColumn(EXCEL_COLUMNS.findIndex((c) => c.key === 'currentBookValue') + 1);
  bookValueCol.numFmt = IDR_NUM_FMT;

  // Summary row
  const summaryRow = ws.addRow({});
  ws.getCell(`A${summaryRow.number}`).value = `Total: ${xlsxRows.length} assets`;
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
