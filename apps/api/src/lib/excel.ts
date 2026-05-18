import ExcelJS from 'exceljs';
import { prisma } from './prisma.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AssetImportRow {
  rowIndex: number;
  /** Resolved product UUID (after parser maps from name/EAN/UUID/new-product spec). */
  productId: string;
  /** Present only when the productId field above was synthesised from a row
   * that requested a new product. The bulkImport service uses this to insert
   * the product before the asset (deduped across rows by Name+Category). */
  newProductSpec?: {
    name: string;
    categoryName: string;
    brand?: string;
    model?: string;
    eanCode?: string;
  };
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
  { header: 'Product*', key: 'productId', width: 35, required: true, example: 'MacBook Pro 14' },
  { header: 'Name*', key: 'name', width: 30, required: true, example: 'MacBook Pro 14 - Unit 5' },
  { header: 'Location*', key: 'locationId', width: 35, required: true, example: 'Head Office Lantai 1' },
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

  // ── Fields used ONLY when the product in column "Product" does not yet
  // exist in the system. Leave blank to require that the product already
  // be in the catalog. Provide at minimum "Product Category" to create
  // a new product on-the-fly during import.
  { header: 'Product Category', key: 'productCategory', width: 25, required: false, example: 'IT Equipment' },
  { header: 'Product Brand', key: 'productBrand', width: 20, required: false, example: 'Apple' },
  { header: 'Product Model', key: 'productModel', width: 20, required: false, example: 'A2992' },
  { header: 'Product EAN', key: 'productEan', width: 18, required: false, example: '8801643734718' },
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

  // ── Reference sheet: Products ──────────────────────────────────────
  // Listed so the user can copy either the UUID or the EAN-13 code into
  // the import sheet's "Product ID or EAN" column.
  const products = await prisma.product.findMany({
    select: { id: true, eanCode: true, name: true, brand: true, model: true },
    orderBy: { name: 'asc' },
  });
  const productsWs = wb.addWorksheet('Products', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  productsWs.columns = [
    { header: 'Product ID (UUID)', key: 'id', width: 40 },
    { header: 'EAN', key: 'eanCode', width: 18 },
    { header: 'Name', key: 'name', width: 35 },
    { header: 'Brand', key: 'brand', width: 20 },
    { header: 'Model', key: 'model', width: 20 },
  ];
  styleHeader(productsWs.getRow(1));
  for (const p of products) {
    productsWs.addRow({
      id: p.id,
      eanCode: p.eanCode ?? '',
      name: p.name,
      brand: p.brand ?? '',
      model: p.model ?? '',
    });
  }
  productsWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 5 },
  };

  // ── Reference sheet: Categories ────────────────────────────────────
  // Required when the "Product" column refers to a new product not yet
  // in the catalog — fill "Product Category" with one of these names.
  const categories = await prisma.assetCategory.findMany({
    select: { id: true, code: true, name: true, description: true },
    orderBy: { name: 'asc' },
  });
  const categoriesWs = wb.addWorksheet('Categories', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  categoriesWs.columns = [
    { header: 'Category Name', key: 'name', width: 30 },
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Description', key: 'description', width: 50 },
  ];
  styleHeader(categoriesWs.getRow(1));
  for (const c of categories) {
    categoriesWs.addRow({
      name: c.name,
      code: c.code,
      description: c.description ?? '',
    });
  }
  categoriesWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 3 },
  };

  // ── Reference sheet: Locations ─────────────────────────────────────
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, city: true, type: true },
    orderBy: { name: 'asc' },
  });
  const locationsWs = wb.addWorksheet('Locations', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  locationsWs.columns = [
    { header: 'Location ID (UUID)', key: 'id', width: 40 },
    { header: 'Code', key: 'code', width: 16 },
    { header: 'Name', key: 'name', width: 35 },
    { header: 'City', key: 'city', width: 20 },
    { header: 'Type', key: 'type', width: 18 },
  ];
  styleHeader(locationsWs.getRow(1));
  for (const l of locations) {
    locationsWs.addRow({
      id: l.id,
      code: l.code,
      name: l.name,
      city: l.city ?? '',
      type: l.type,
    });
  }
  locationsWs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 5 },
  };

  // Instructions worksheet
  const instructWs = wb.addWorksheet('Instructions');
  instructWs.getCell('A1').value = 'Wedisense Asset Import Template';
  instructWs.getCell('A1').font = { bold: true, size: 14 };
  instructWs.getCell('A3').value = 'Instructions:';
  instructWs.getCell('A3').font = { bold: true };
  const instructions = [
    '1. Fill in the "Assets Import" sheet starting from row 3 (row 2 is a sample — delete it before importing).',
    '2. Fields marked with * are required.',
    '',
    'PRODUCT column (column A) — type the product name.',
    'CASE A: The product already exists in the catalog',
    '   Just type the name (e.g. "MacBook Pro 14"). The "Product Brand",',
    '   "Product Model", "Product EAN" and "Product Category" columns can be',
    '   left blank — they are ignored when the product is found.',
    '',
    'CASE B: The product does NOT exist yet (e.g. you are bringing in a new',
    'brand or model for the first time)',
    '   • Type the new product name in column A',
    '   • Fill in "Product Category" (required) — pick from the "Categories" sheet',
    '   • Optionally fill in "Product Brand", "Product Model", "Product EAN"',
    '   The product will be created automatically during import, and the asset',
    '   row will reference it. If multiple rows have the same new product name',
    '   + category, only ONE product is created and reused across all rows.',
    '',
    'LOCATION column — type the location name (must already exist).',
    '   • "Head Office Lantai 1"     (Name — easiest)',
    '   • "PI-HO-L1"                 (Code — short)',
    '   • "f3285de6-..."             (UUID — copy from the "Locations" sheet)',
    '   Locations are NOT auto-created (to prevent typos creating new sites).',
    '',
    'Matching is case-insensitive. See "Products", "Categories", "Locations"',
    'sheets for the full lists.',
    '',
    'Other fields:',
    '   Status:    ACTIVE | IDLE | IN_MAINTENANCE | DISPOSED | LOST | BORROWED  (default ACTIVE)',
    '   Condition: NEW | GOOD | FAIR | POOR | DAMAGED                            (default NEW)',
    '   Date:      YYYY-MM-DD format, e.g. 2024-01-15',
    '   Price:     numeric only, no currency symbol or thousand separator',
    '   Currency:  3-letter ISO code, defaults to IDR if blank',
  ];
  instructions.forEach((text, i) => {
    instructWs.getCell(`A${4 + i}`).value = text;
  });
  instructWs.getColumn('A').width = 100;

  // ExcelJS declares its own Buffer interface (extends ArrayBuffer), not Node's Buffer.
  // The cast is required to bridge these incompatible type declarations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const rawBuffer = await wb.xlsx.writeBuffer() as unknown as Buffer;
  return rawBuffer;
}

// Helper for consistent header styling across all reference sheets.
function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  row.height = 22;
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
    // Match exactly (ignoring the trailing "*" required marker) so that
    // "Product Category" does NOT match the "Product" column. Earlier code
    // used startsWith which broke once columns shared a prefix.
    const normalised = raw.replace(/\*$/, '').trim().toLowerCase();
    const col = IMPORT_COLUMNS.find(
      (c) => c.header.replace(/\*$/, '').trim().toLowerCase() === normalised,
    );
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

    // Required field validation. productId and locationId may be either
    // a UUID or a natural key (product EAN-13 / location code) — the
    // post-pass below resolves natural keys to UUIDs in a single query.
    if (!productId) {
      rowErrors.push({ rowIndex: rowNum, field: 'productId', message: 'Product ID or EAN is required', value: productId });
    }

    if (!name) {
      rowErrors.push({ rowIndex: rowNum, field: 'name', message: 'Name is required', value: name });
    }

    if (!locationId) {
      rowErrors.push({ rowIndex: rowNum, field: 'locationId', message: 'Location ID or code is required', value: locationId });
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

    // Optional product-creation hints (used by post-pass only if the
    // product cannot be resolved against the existing catalog).
    const productCategory = getCellValue(row, 'productCategory') || undefined;
    const productBrand = getCellValue(row, 'productBrand') || undefined;
    const productModel = getCellValue(row, 'productModel') || undefined;
    const productEan = getCellValue(row, 'productEan') || undefined;

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
      // Stash hints on the row for the resolver below.
      ...(productCategory || productBrand || productModel || productEan
        ? {
            newProductSpec: {
              name: productId, // user's value in column A is the new product name
              categoryName: productCategory ?? '',
              ...(productBrand && { brand: productBrand }),
              ...(productModel && { model: productModel }),
              ...(productEan && { eanCode: productEan }),
            },
          }
        : {}),
    });
  });

  // ── Resolve human-friendly references to UUIDs ──────────────────────
  // Each field can be:
  //   - a UUID  → used as-is, no DB lookup
  //   - an EAN-13 (Product) or location code (Location) → exact match
  //   - a Name → case-insensitive exact match against name
  // If the same name matches multiple records, we surface a disambiguation
  // error rather than silently picking the first match.
  const naturalProductKeys = new Set<string>();
  const naturalLocationKeys = new Set<string>();
  for (const r of rows) {
    if (r.productId && !isValidUuid(r.productId)) naturalProductKeys.add(r.productId);
    if (r.locationId && !isValidUuid(r.locationId)) naturalLocationKeys.add(r.locationId);
  }

  // Resolution result per key. If multiple matches, we keep the list so we
  // can format a useful error.
  type Match<T> = { unique: T } | { ambiguous: T[] } | undefined;
  type ProductRef = {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    eanCode: string | null;
  };
  type LocationRef = { id: string; code: string; name: string };
  const productByKey = new Map<string, Match<ProductRef>>();
  const locationByKey = new Map<string, Match<LocationRef>>();

  if (naturalProductKeys.size > 0) {
    const keys = Array.from(naturalProductKeys);
    const lowered = keys.map((k) => k.toLowerCase());
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { eanCode: { in: keys } },
          // Prisma's `mode: 'insensitive'` works on Postgres for citext-style search.
          { name: { in: keys, mode: 'insensitive' } },
        ],
      },
      select: { id: true, eanCode: true, name: true, brand: true, model: true },
    });

    // Build lookup maps: by EAN (exact) and by lowercased name (collect all matches)
    const byEan = new Map<string, typeof products[number]>();
    const byName: Map<string, typeof products[number][]> = new Map();
    for (const p of products) {
      if (p.eanCode) byEan.set(p.eanCode, p);
      const nKey = p.name.toLowerCase();
      const arr = byName.get(nKey) ?? [];
      arr.push(p);
      byName.set(nKey, arr);
    }

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const ean = byEan.get(k);
      if (ean) {
        productByKey.set(k, { unique: ean });
        continue;
      }
      const nameMatches = byName.get(lowered[i]!);
      if (nameMatches && nameMatches.length === 1) {
        productByKey.set(k, { unique: nameMatches[0]! });
      } else if (nameMatches && nameMatches.length > 1) {
        productByKey.set(k, { ambiguous: nameMatches });
      } else {
        productByKey.set(k, undefined);
      }
    }
  }

  if (naturalLocationKeys.size > 0) {
    const keys = Array.from(naturalLocationKeys);
    const lowered = keys.map((k) => k.toLowerCase());
    const locations = await prisma.location.findMany({
      where: {
        isActive: true,
        OR: [
          { code: { in: keys } },
          { name: { in: keys, mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map<string, typeof locations[number]>();
    const byName: Map<string, typeof locations[number][]> = new Map();
    for (const l of locations) {
      byCode.set(l.code, l);
      const nKey = l.name.toLowerCase();
      const arr = byName.get(nKey) ?? [];
      arr.push(l);
      byName.set(nKey, arr);
    }

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      const code = byCode.get(k);
      if (code) {
        locationByKey.set(k, { unique: code });
        continue;
      }
      const nameMatches = byName.get(lowered[i]!);
      if (nameMatches && nameMatches.length === 1) {
        locationByKey.set(k, { unique: nameMatches[0]! });
      } else if (nameMatches && nameMatches.length > 1) {
        locationByKey.set(k, { ambiguous: nameMatches });
      } else {
        locationByKey.set(k, undefined);
      }
    }
  }

  // Apply resolution, drop rows that fail to resolve into errors[].
  const resolved: AssetImportRow[] = [];
  for (const r of rows) {
    const rowResolutionErrors: ParseError[] = [];

    if (r.productId && !isValidUuid(r.productId)) {
      const match = productByKey.get(r.productId);
      if (match && 'unique' in match) {
        // Existing product found — clear any newProductSpec hint (we don't
        // want to overwrite an existing product's metadata from import hints).
        r.productId = match.unique.id;
        delete r.newProductSpec;
      } else if (match && 'ambiguous' in match) {
        const opts = match.ambiguous
          .slice(0, 3)
          .map((p) => `"${p.name}${p.brand ? ` (${p.brand}${p.model ? ` ${p.model}` : ''})` : ''}" [${p.eanCode ?? 'no EAN'}]`)
          .join(', ');
        rowResolutionErrors.push({
          rowIndex: r.rowIndex,
          field: 'productId',
          message: `Product "${r.productId}" matches ${match.ambiguous.length} entries: ${opts}. Use the EAN code or UUID to disambiguate (see the "Products" sheet).`,
          value: r.productId,
        });
      } else if (r.newProductSpec && r.newProductSpec.categoryName) {
        // Not in catalog but caller provided category → mark for creation.
        // productId stays the natural-key string; bulkImport resolves it.
        r.newProductSpec.name = r.productId; // ensure name matches column A
      } else {
        rowResolutionErrors.push({
          rowIndex: r.rowIndex,
          field: 'productId',
          message: `Product "${r.productId}" not found. To CREATE a new product, also fill in "Product Category" (required) and optionally Brand/Model/EAN. To use an existing product, pick one from the "Products" sheet.`,
          value: r.productId,
        });
      }
    } else if (r.productId && isValidUuid(r.productId)) {
      // UUID supplied — disregard any newProductSpec hint to avoid surprises.
      delete r.newProductSpec;
    }

    if (r.locationId && !isValidUuid(r.locationId)) {
      const match = locationByKey.get(r.locationId);
      if (match && 'unique' in match) {
        r.locationId = match.unique.id;
      } else if (match && 'ambiguous' in match) {
        const opts = match.ambiguous
          .slice(0, 3)
          .map((l) => `"${l.name}" [code: ${l.code}]`)
          .join(', ');
        rowResolutionErrors.push({
          rowIndex: r.rowIndex,
          field: 'locationId',
          message: `Location "${r.locationId}" matches ${match.ambiguous.length} entries: ${opts}. Use the location code or UUID to disambiguate (see the "Locations" sheet).`,
          value: r.locationId,
        });
      } else {
        rowResolutionErrors.push({
          rowIndex: r.rowIndex,
          field: 'locationId',
          message: `Location "${r.locationId}" not found. Open the "Locations" sheet in the template and use a Name, code, or UUID from that list.`,
          value: r.locationId,
        });
      }
    }

    if (rowResolutionErrors.length === 0) {
      resolved.push(r);
    } else {
      errors.push(...rowResolutionErrors);
    }
  }

  return { rows: resolved, errors };
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
