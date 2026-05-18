import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createWorkbook, writeRowsToWorksheet } from '../../../lib/excel.js';
import { createReportPdf } from '../../../lib/report-pdf.js';
import type { ReportParameters } from '../types.js';

const EXCEL_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 22 },
  { header: 'Asset Name', key: 'assetName', width: 28 },
  { header: 'Schedule', key: 'scheduleName', width: 25 },
  { header: 'Performed By', key: 'performedBy', width: 22 },
  { header: 'Performed At', key: 'performedAt', width: 18 },
  { header: 'Description', key: 'description', width: 35 },
  { header: 'Findings', key: 'findings', width: 30 },
  { header: 'Action Taken', key: 'actionTaken', width: 30 },
  { header: 'Condition Before', key: 'conditionBefore', width: 18 },
  { header: 'Condition After', key: 'conditionAfter', width: 18 },
  { header: 'Cost (IDR)', key: 'cost', width: 18 },
  { header: 'Vendor', key: 'vendorName', width: 22 },
];

const PDF_COLUMNS = [
  { header: 'Asset #', key: 'assetNumber', width: 2 },
  { header: 'Asset Name', key: 'assetName', width: 2.5 },
  { header: 'Performed By', key: 'performedBy', width: 2 },
  { header: 'Date', key: 'performedAt', width: 1.5 },
  { header: 'Description', key: 'description', width: 3 },
  { header: 'Cond. Before', key: 'conditionBefore', width: 1.5 },
  { header: 'Cond. After', key: 'conditionAfter', width: 1.5 },
  { header: 'Cost (IDR)', key: 'cost', width: 2 },
  { header: 'Vendor', key: 'vendorName', width: 2 },
];

export async function generateMaintenanceReport(
  parameters: ReportParameters,
  format: 'excel' | 'pdf',
): Promise<Buffer> {
  const where: Prisma.MaintenanceLogWhereInput = {};

  if (parameters['assetId']) {
    where.assetId = parameters['assetId'] as string;
  }
  if (parameters['dateFrom'] || parameters['dateTo']) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parameters['dateFrom']) dateFilter.gte = new Date(parameters['dateFrom'] as string);
    if (parameters['dateTo']) dateFilter.lte = new Date(parameters['dateTo'] as string);
    where.performedAt = dateFilter;
  }

  const logs = await prisma.maintenanceLog.findMany({
    where,
    orderBy: { performedAt: 'desc' },
    include: {
      asset: { select: { assetNumber: true, name: true } },
      performedBy: { select: { name: true } },
      schedule: { select: { title: true } },
    },
  });

  const totalCost = logs.reduce((sum, l) => sum + (l.cost ? Number(l.cost) : 0), 0);

  const rows: Record<string, unknown>[] = logs.map((l) => ({
    assetNumber: l.asset.assetNumber,
    assetName: l.asset.name,
    scheduleName: l.schedule?.title ?? 'Ad-hoc',
    performedBy: l.performedBy.name,
    performedAt: l.performedAt.toISOString().split('T')[0] ?? '',
    description: l.description,
    findings: l.findings ?? '',
    actionTaken: l.actionTaken ?? '',
    conditionBefore: l.conditionBefore,
    conditionAfter: l.conditionAfter,
    cost: l.cost ? Number(l.cost).toLocaleString('id-ID') : '0',
    vendorName: l.vendorName ?? '',
  }));

  if (format === 'pdf') {
    return createReportPdf({
      title: 'Maintenance Report',
      subtitle: `Total: ${rows.length} logs`,
      columns: PDF_COLUMNS,
      rows,
      metadata: {
        'Total Cost': `IDR ${totalCost.toLocaleString('id-ID')}`,
      },
    });
  }

  const wb = createWorkbook();
  const ws = wb.addWorksheet('Maintenance Logs', { views: [{ state: 'frozen', ySplit: 1 }] });
  writeRowsToWorksheet(ws, EXCEL_COLUMNS, rows);

  // Cost summary row
  const summaryRow = ws.addRow({});
  const costColIdx = EXCEL_COLUMNS.findIndex((c) => c.key === 'cost') + 1;
  ws.getCell(summaryRow.number, costColIdx - 1).value = 'Total Cost:';
  ws.getCell(summaryRow.number, costColIdx - 1).font = { bold: true };
  ws.getCell(summaryRow.number, costColIdx).value = `IDR ${totalCost.toLocaleString('id-ID')}`;
  ws.getCell(summaryRow.number, costColIdx).font = { bold: true };

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: EXCEL_COLUMNS.length },
  };

  // ExcelJS Buffer is not Node Buffer; cast required to bridge type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}
