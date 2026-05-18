import ExcelJS from 'exceljs';

// ── Types ────────────────────────────────────────────────────────────

export interface AssetImportRow {
  rowIndex: number;
  productId: string;
  name: string;
  serialNumber?: string;
  status: 'ACTIVE' | 'IDLE' | 'IN_MAINTENANCE' | 'DISPOSED' | 'LOST' | 'BORROWED';
  condition: 'NEW' | 'GOOD' | 'FAIR' | 'POOR' | 'DAMAGED';
  locationId: string;
  assignedToUserId?: string;
  purchaseDate?: Date;
  purchasePrice?: number;
  currency: string;
  vendor?: string;
  invoiceNumber?: string;
  warrantyStartDate?: Date;
  warrantyEndDate?: Date;
  usefulLifeMonths?: number;
  notes?: string;
}

export interface ParseError {
  rowIndex: number;
  field: string;
  message: string;
  value?: unknown;
}

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
}

// ── Column definitions ────────────────────────────────────────────────

const IMPORT_COLUMNS: Array<{
  header: string;
  key: string;
  width: number;
  required: boolean;
  example: string;
}> = [
  { header: 'Product ID (UUID)*', key: 'productId', width: 40, required: true, example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
  { header: 'Name*', key: 'name', width: 30, required: true, example: 'MacBook Pro 14"' },
  { header: 'Location ID (UUID)*', key: 'locationId', width: 40, required: true, example: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
  { header: 'Serial Number', key: 'serialNumber', width: 25, required: false, example: 'C02XY1234' },
  { header: 'Status', key: 'status', width: 18, required: false, example: 'ACTIVE' },
  { header: 'Condition', key: 'condition', width: 15, required: false, example: 'NEW' },
  { header: 'Assigned To User ID', key: 'assignedToUserId', width: 40, required: false, example: '' },
  { header: 'Purchase Date', key: 'purchaseDate', width: 18, required: false, example: '2024-01-15' },
  { header: 'Purchase Price', key: 'purchasePrice', width: 18, required: false, example: '25000000' },
  { header: 'Currency', key: 'currency', width: 12, required: false, example: 'IDR' },
  { header: 'Vendor', key: 'vendor', width: 25, required: false, example: 'Apple Indonesia' },
  { header: 'Invoice Number', key: 'invoiceNumber', width: 20, required: false, example: 'INV-2024-001' },
  { header: 'Warranty Start Date', key: 'warrantyStartDate', width: 22, required: false, example: '2024-01-15' },
  { header: 'Warranty End Date', key: 'warrantyEndDate', width: 22, required: false, example: '2025-01-14' },
  { header: 'Useful Life (months)', key: 'usefulLifeMonths', width: 22, required: false, example: '36' },
  { header: 'Notes', key: 'notes', width: 40, required: false, example: '' },
];

const VALID_STATUSES = ['ACTIVE', 'IDLE', 'IN_MAINTENANCE', 'DISPOSED', 'LOST', 'BORROWED'] as const;
const VALID_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;

type ValidStatus = (typeof VALID_STATUSES)[number];
type ValidCondition = (typeof VALID_CONDITIONS)[number];

// ── createWorkbook ────────────────────────────────────────────────────

export function createWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wedisense AMS';
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

// ── buildAssetImportTemplate ──────────────────────────────────────────

export async function buildAssetImportTemplate(): Promise<Buffer> {
  const wb = createWorkbook();
  const ws = wb.addWorksheet('Assets Import', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Header row
  ws.columns = IMPORT_COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
  headerRow.height = 22;

  // Sample row
  const sampleData: Record<string, string> = {};
  for (const col of IMPORT_COLUMNS) {
    sampleData[col.key] = col.example;
  }
  const sampleRow = ws.addRow(sampleData);
  sampleRow.font = { italic: true, color: { argb: 'FF888888' } };

  // Data validation for Status column
  const statusColLetter = ws.getColumn('status').letter;
  const statusValidation: ExcelJS.DataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"ACTIVE,IDLE,IN_MAINTENANCE,DISPOSED,LOST,BORROWED"'],
    showErrorMessage: true,
    errorTitle: 'Invalid Status',
    error: 'Please select a valid status value',
  };
  for (let r = 3; r <= 1000; r++) {
    ws.getCell(`${statusColLetter}${r}`).dataValidation = statusValidation;
  }

  // Data validation for Condition column
  const conditionColLetter = ws.getColumn('condition').letter;
  const conditionValidation: ExcelJS.DataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"NEW,GOOD,FAIR,POOR,DAMAGED"'],
    showErrorMessage: true,
    errorTitle: 'Invalid Condition',
    error: 'Please select a valid condition value',
  };
  for (let r = 3; r <= 1000; r++) {
    ws.getCell(`${conditionColLetter}${r}`).dataValidation = conditionValidation;
  }

  // Instructions worksheet
  const instructWs = wb.addWorksheet('Instructions');
  instructWs.getCell('A1').value = 'Wedisense Asset Import Template';
  instructWs.getCell('A1').font = { bold: true, size: 14 };
  instructWs.getCell('A3').value = 'Instructions:';
  instructWs.getCell('A3').font = { bold: true };
  const instructions = [
    '1. Fill in the "Assets Import" sheet starting from row 3 (row 2 is a sample).',
    '2. Fields marked with * are required.',
    '3. Product ID and Location ID must be valid UUIDs from the system.',
    '4. Status values: ACTIVE, IDLE, IN_MAINTENANCE, DISPOSED, LOST, BORROWED',
    '5. Condition values: NEW, GOOD, FAIR, POOR, DAMAGED',
    '6. Date format: YYYY-MM-DD (e.g. 2024-01-15)',
    '7. Purchase Price should be numeric only (no currency symbol).',
    '8. Delete the sample row (row 2) before importing.',
  ];
  instructions.forEach((text, i) => {
    instructWs.getCell(`A${4 + i}`).value = text;
  });
  instructWs.getColumn('A').width = 80;

  // ExcelJS declares its own Buffer interface (extends ArrayBuffer), not Node's Buffer.
  // The cast is required to bridge these incompatible type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}

// ── parseAssetImportSheet ─────────────────────────────────────────────

export async function parseAssetImportSheet(
  buffer: Buffer,
): Promise<{ rows: AssetImportRow[]; errors: ParseError[] }> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's Buffer type is not Node's Buffer; cast required.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  const ws = wb.getWorksheet('Assets Import') ?? wb.worksheets[0];
  if (!ws) {
    return {
      rows: [],
      errors: [{ rowIndex: 0, field: 'sheet', message: 'No worksheet found in the uploaded file' }],
    };
  }

  const rows: AssetImportRow[] = [];
  const errors: ParseError[] = [];

  // Build header map from first row
  const headerMap: Map<string, number> = new Map();
  const firstRow = ws.getRow(1);
  firstRow.eachCell((cell, colNum) => {
    const cellVal = cell.value;
    const raw = (cellVal === null || cellVal === undefined ? '' : typeof cellVal === 'object' ? '' : String(cellVal)).trim();
    // Normalize header to key
    const col = IMPORT_COLUMNS.find((c) => raw.startsWith(c.header.replace('*', '').trim()));
    if (col) {
      headerMap.set(col.key, colNum);
    }
  });

  if (headerMap.size === 0) {
    return {
      rows: [],
      errors: [{ rowIndex: 1, field: 'headers', message: 'No recognizable header row found. Make sure you are using the official import template.' }],
    };
  }

  function getCellValue(row: ExcelJS.Row, key: string): string {
    const colNum = headerMap.get(key);
    if (!colNum) return '';
    const cell = row.getCell(colNum);
    if (cell.value === null || cell.value === undefined) return '';
    if (cell.value instanceof Date) {
      return cell.value.toISOString().split('T')[0] ?? '';
    }
    if (typeof cell.value === 'object') return '';
    return String(cell.value).trim();
  }

  // Start from row 2 (skip header), also skip sample row if it looks like instructions
  ws.eachRow((row, rowNum) => {
    if (rowNum < 2) return; // skip header

    const productId = getCellValue(row, 'productId');
    const name = getCellValue(row, 'name');
    const locationId = getCellValue(row, 'locationId');

    // Skip completely empty rows
    if (!productId && !name && !locationId) return;

    // Skip the sample/example row
    if (productId === 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx') return;

    const rowErrors: ParseError[] = [];

    // Required field validation
    if (!productId) {
      rowErrors.push({ rowIndex: rowNum, field: 'productId', message: 'Product ID is required', value: productId });
    } else if (!isValidUuid(productId)) {
      rowErrors.push({ rowIndex: rowNum, field: 'productId', message: 'Product ID must be a valid UUID', value: productId });
    }

    if (!name) {
      rowErrors.push({ rowIndex: rowNum, field: 'name', message: 'Name is required', value: name });
    }

    if (!locationId) {
      rowErrors.push({ rowIndex: rowNum, field: 'locationId', message: 'Location ID is required', value: locationId });
    } else if (!isValidUuid(locationId)) {
      rowErrors.push({ rowIndex: rowNum, field: 'locationId', message: 'Location ID must be a valid UUID', value: locationId });
    }

    // Optional UUID fields
    const assignedToUserId = getCellValue(row, 'assignedToUserId') || undefined;
    if (assignedToUserId && !isValidUuid(assignedToUserId)) {
      rowErrors.push({ rowIndex: rowNum, field: 'assignedToUserId', message: 'Assigned To User ID must be a valid UUID', value: assignedToUserId });
    }

    // Status
    const statusRaw = getCellValue(row, 'status') || 'ACTIVE';
    const status = statusRaw.toUpperCase() as ValidStatus;
    if (!VALID_STATUSES.includes(status)) {
      rowErrors.push({ rowIndex: rowNum, field: 'status', message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, value: statusRaw });
    }

    // Condition
    const conditionRaw = getCellValue(row, 'condition') || 'NEW';
    const condition = conditionRaw.toUpperCase() as ValidCondition;
    if (!VALID_CONDITIONS.includes(condition)) {
      rowErrors.push({ rowIndex: rowNum, field: 'condition', message: `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`, value: conditionRaw });
    }

    // Dates
    const purchaseDate = parseDateCell(getCellValue(row, 'purchaseDate'));
    const warrantyStartDate = parseDateCell(getCellValue(row, 'warrantyStartDate'));
    const warrantyEndDate = parseDateCell(getCellValue(row, 'warrantyEndDate'));

    // Purchase price
    const purchasePriceRaw = getCellValue(row, 'purchasePrice');
    let purchasePrice: number | undefined;
    if (purchasePriceRaw) {
      const parsed = parseFloat(purchasePriceRaw.replace(/[^0-9.]/g, ''));
      if (isNaN(parsed) || parsed < 0) {
        rowErrors.push({ rowIndex: rowNum, field: 'purchasePrice', message: 'Purchase price must be a non-negative number', value: purchasePriceRaw });
      } else {
        purchasePrice = parsed;
      }
    }

    // Useful life
    const usefulLifeRaw = getCellValue(row, 'usefulLifeMonths');
    let usefulLifeMonths: number | undefined;
    if (usefulLifeRaw) {
      const parsed = parseInt(usefulLifeRaw, 10);
      if (isNaN(parsed) || parsed <= 0) {
        rowErrors.push({ rowIndex: rowNum, field: 'usefulLifeMonths', message: 'Useful life must be a positive integer', value: usefulLifeRaw });
      } else {
        usefulLifeMonths = parsed;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    rows.push({
      rowIndex: rowNum,
      productId,
      name,
      locationId,
      serialNumber: getCellValue(row, 'serialNumber') || undefined,
      status,
      condition,
      assignedToUserId,
      purchaseDate: purchaseDate ?? undefined,
      purchasePrice,
      currency: getCellValue(row, 'currency') || 'IDR',
      vendor: getCellValue(row, 'vendor') || undefined,
      invoiceNumber: getCellValue(row, 'invoiceNumber') || undefined,
      warrantyStartDate: warrantyStartDate ?? undefined,
      warrantyEndDate: warrantyEndDate ?? undefined,
      usefulLifeMonths,
      notes: getCellValue(row, 'notes') || undefined,
    });
  });

  return { rows, errors };
}

// ── writeRowsToWorksheet ──────────────────────────────────────────────

export function writeRowsToWorksheet(
  worksheet: ExcelJS.Worksheet,
  columns: ColumnDef[],
  rows: Record<string, unknown>[],
): void {
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 20,
  }));

  // Style header
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  headerRow.height = 20;

  // Add data rows
  for (const row of rows) {
    const rowData: Record<string, unknown> = {};
    for (const col of columns) {
      rowData[col.key] = row[col.key] ?? '';
    }
    worksheet.addRow(rowData);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseDateCell(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date;
}
