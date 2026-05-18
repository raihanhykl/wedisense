import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { createWorkbook, writeRowsToWorksheet } from '../../../lib/excel.js';
import { createReportPdf } from '../../../lib/report-pdf.js';
import type { ReportParameters } from '../types.js';

const EXCEL_COLUMNS = [
  { header: 'Date/Time', key: 'createdAt', width: 22 },
  { header: 'User', key: 'userName', width: 22 },
  { header: 'Action', key: 'action', width: 14 },
  { header: 'Resource Type', key: 'resourceType', width: 20 },
  { header: 'Resource ID', key: 'resourceId', width: 36 },
  { header: 'Old Values', key: 'oldValues', width: 40 },
  { header: 'New Values', key: 'newValues', width: 40 },
  { header: 'IP Address', key: 'ipAddress', width: 18 },
  { header: 'User Agent', key: 'userAgent', width: 40 },
];

const PDF_COLUMNS = [
  { header: 'Date/Time', key: 'createdAt', width: 2 },
  { header: 'User', key: 'userName', width: 2 },
  { header: 'Action', key: 'action', width: 1.5 },
  { header: 'Resource Type', key: 'resourceType', width: 2 },
  { header: 'Resource ID', key: 'resourceId', width: 3 },
  { header: 'Old Values', key: 'oldValues', width: 3 },
  { header: 'New Values', key: 'newValues', width: 3 },
  { header: 'IP Address', key: 'ipAddress', width: 1.5 },
];

export async function generateAuditReport(
  parameters: ReportParameters,
  format: 'excel' | 'pdf',
): Promise<Buffer> {
  const where: Prisma.AuditLogWhereInput = {};

  if (parameters['action']) {
    where.action = parameters['action'] as Prisma.EnumAuditActionFilter;
  }
  if (parameters['resourceType']) {
    where.resourceType = parameters['resourceType'] as string;
  }
  if (parameters['userId']) {
    where.userId = parameters['userId'] as string;
  }
  if (parameters['dateFrom'] || parameters['dateTo']) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parameters['dateFrom']) dateFilter.gte = new Date(parameters['dateFrom'] as string);
    if (parameters['dateTo']) dateFilter.lte = new Date(parameters['dateTo'] as string);
    where.createdAt = dateFilter;
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, email: true } },
    },
    // Cap at 10k rows to avoid memory issues
    take: 10000,
  });

  const rows: Record<string, unknown>[] = logs.map((l) => ({
    createdAt: l.createdAt.toISOString().replace('T', ' ').split('.')[0] ?? '',
    userName: l.user ? `${l.user.name} <${l.user.email}>` : 'System',
    action: l.action,
    resourceType: l.resourceType,
    resourceId: l.resourceId,
    oldValues: l.oldValues ? JSON.stringify(l.oldValues) : '',
    newValues: l.newValues ? JSON.stringify(l.newValues) : '',
    ipAddress: l.ipAddress ?? '',
    userAgent: l.userAgent ?? '',
  }));

  if (format === 'pdf') {
    return createReportPdf({
      title: 'Audit Log Report',
      subtitle: `Total: ${rows.length} entries`,
      columns: PDF_COLUMNS,
      rows,
    });
  }

  const wb = createWorkbook();
  const ws = wb.addWorksheet('Audit Logs', { views: [{ state: 'frozen', ySplit: 1 }] });
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
