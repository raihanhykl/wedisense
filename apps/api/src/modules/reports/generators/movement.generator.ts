import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createWorkbook, writeRowsToWorksheet } from '../../../lib/excel.js';
import { createReportPdf } from '../../../lib/report-pdf.js';
import type { ReportParameters } from '../types.js';

const EXCEL_COLUMNS = [
  { header: 'Reference #', key: 'referenceNumber', width: 26 },
  { header: 'Asset #', key: 'assetNumber', width: 22 },
  { header: 'Asset Name', key: 'assetName', width: 28 },
  { header: 'Movement Type', key: 'movementType', width: 22 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'From User', key: 'fromUser', width: 22 },
  { header: 'To User', key: 'toUser', width: 22 },
  { header: 'From Location', key: 'fromLocation', width: 22 },
  { header: 'To Location', key: 'toLocation', width: 22 },
  { header: 'Performed By', key: 'performedBy', width: 22 },
  { header: 'Notes', key: 'notes', width: 35 },
  { header: 'Date', key: 'date', width: 18 },
];

const PDF_COLUMNS = [
  { header: 'Reference #', key: 'referenceNumber', width: 2 },
  { header: 'Asset #', key: 'assetNumber', width: 2 },
  { header: 'Type', key: 'movementType', width: 2 },
  { header: 'Status', key: 'status', width: 1.5 },
  { header: 'From', key: 'fromUser', width: 2 },
  { header: 'To', key: 'toUser', width: 2 },
  { header: 'From Loc', key: 'fromLocation', width: 2 },
  { header: 'To Loc', key: 'toLocation', width: 2 },
  { header: 'Performed By', key: 'performedBy', width: 2 },
  { header: 'Date', key: 'date', width: 2 },
];

export async function generateMovementReport(
  parameters: ReportParameters,
  format: 'excel' | 'pdf',
): Promise<Buffer> {
  const where: Prisma.AssetMovementWhereInput = {};

  if (parameters['movementType']) {
    where.movementType = parameters['movementType'] as Prisma.EnumMovementTypeFilter;
  }
  if (parameters['status']) {
    where.status = parameters['status'] as Prisma.EnumMovementStatusFilter;
  }
  if (parameters['dateFrom'] || parameters['dateTo']) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parameters['dateFrom']) dateFilter.gte = new Date(parameters['dateFrom'] as string);
    if (parameters['dateTo']) dateFilter.lte = new Date(parameters['dateTo'] as string);
    where.createdAt = dateFilter;
  }
  if (parameters['assetId']) {
    where.assetId = parameters['assetId'] as string;
  }

  const movements = await prisma.assetMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      asset: { select: { assetNumber: true, name: true } },
      fromUser: { select: { name: true } },
      toUser: { select: { name: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      performedBy: { select: { name: true } },
    },
  });

  const rows: Record<string, unknown>[] = movements.map((m) => ({
    referenceNumber: m.referenceNumber,
    assetNumber: m.asset.assetNumber,
    assetName: m.asset.name,
    movementType: m.movementType,
    status: m.status,
    fromUser: m.fromUser?.name ?? '',
    toUser: m.toUser?.name ?? '',
    fromLocation: m.fromLocation?.name ?? '',
    toLocation: m.toLocation?.name ?? '',
    performedBy: m.performedBy.name,
    notes: m.notes ?? '',
    date: m.createdAt.toISOString().split('T')[0] ?? '',
  }));

  if (format === 'pdf') {
    return createReportPdf({
      title: 'Movement Report',
      subtitle: `Total: ${rows.length} movements`,
      columns: PDF_COLUMNS,
      rows,
    });
  }

  const wb = createWorkbook();
  const ws = wb.addWorksheet('Movements', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRowsToWorksheet(ws, EXCEL_COLUMNS, rows);
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: EXCEL_COLUMNS.length },
  };

  // ExcelJS Buffer is not Node Buffer; cast required to bridge type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}
