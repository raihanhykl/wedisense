import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import bwipjs from 'bwip-js';
import type { LabelField, AssetData } from '../modules/labels/types.js';

// qrcode has no type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as {
  toBuffer: (text: string, opts?: Record<string, unknown>) => Promise<Buffer>;
};

const STORAGE_PATH = process.env['STORAGE_PATH'] ?? './uploads';
const MM_TO_PT = 2.83465;

function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Resolve an asset field value by key.
 */
function resolveFieldValue(asset: AssetData, fieldKey: string): string {
  // Support both snake_case (from frontend) and camelCase keys
  const map: Record<string, string | null> = {
    asset_number: asset.assetNumber,
    assetNumber: asset.assetNumber,
    serial_number: asset.serialNumber,
    serialNumber: asset.serialNumber,
    name: asset.name,
    location: asset.location,
    assigned_to: asset.assignedTo,
    assignedTo: asset.assignedTo,
    purchase_date: asset.purchaseDate,
    purchaseDate: asset.purchaseDate,
    warranty_end_date: asset.warrantyEndDate,
    warrantyEndDate: asset.warrantyEndDate,
  };
  return map[fieldKey] ?? '';
}

/**
 * Generate a barcode PNG buffer for inline rendering.
 */
async function generateBarcodeBuffer(text: string): Promise<Buffer> {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 10,
    includetext: true,
  });
}

/**
 * Generate a QR code PNG buffer for inline rendering.
 */
async function generateQrBuffer(assetId: string): Promise<Buffer> {
  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
  return QRCode.toBuffer(`${appUrl}/assets/${assetId}`, {
    type: 'png',
    width: 300,
  });
}

/**
 * Render fields onto the current page of a PDFDocument.
 */
async function renderFields(
  doc: PDFKit.PDFDocument,
  fields: LabelField[],
  asset: AssetData & { id: string },
  options: { paperWidthMm: number; paperHeightMm: number },
): Promise<void> {
  for (const field of fields) {
    const x = mmToPt(field.x);
    const y = mmToPt(field.y);
    const width = field.width ? mmToPt(field.width) : undefined;
    const fontSize = field.font_size ?? (field as unknown as Record<string, unknown>)['fontSize'] as number ?? 10;

    switch (field.type) {
      case 'text': {
        // Support legacy seed format: type "text" with "field" property for asset data
        const fieldRef = (field as unknown as Record<string, unknown>)['field'] as string | undefined;
        let text: string;
        if (fieldRef) {
          text = resolveFieldValue(asset, fieldRef);
        } else {
          text = field.custom_value ?? field.label ?? '';
        }
        doc.fontSize(fontSize);
        if (field.bold) {
          doc.font('Helvetica-Bold');
        } else {
          doc.font('Helvetica');
        }
        doc.text(text, x, y, { width, lineBreak: true });
        break;
      }

      case 'field': {
        const key = field.field_key ?? (field as unknown as Record<string, unknown>)['field'] as string ?? '';
        const value = resolveFieldValue(asset, key);
        const label = field.label ? `${field.label}: ` : '';
        doc.fontSize(fontSize);
        if (field.bold) {
          doc.font('Helvetica-Bold');
        } else {
          doc.font('Helvetica');
        }
        doc.text(`${label}${value}`, x, y, { width, lineBreak: true });
        break;
      }

      case 'barcode': {
        try {
          const buffer = await generateBarcodeBuffer(asset.assetNumber);
          // Constrain barcode to field width, or 80% of page width if not set
          const maxWidth = width ?? mmToPt(options.paperWidthMm * 0.8);
          doc.image(buffer, x, y, { width: maxWidth });
        } catch {
          // Fallback: render asset number as text
          doc.fontSize(fontSize).font('Helvetica').text(asset.assetNumber, x, y, { width });
        }
        break;
      }

      case 'qr_code': {
        try {
          const buffer = await generateQrBuffer(asset.id);
          // Constrain QR to field width, or 40% of page height if not set
          const maxWidth = width ?? mmToPt(Math.min(options.paperWidthMm, options.paperHeightMm) * 0.4);
          doc.image(buffer, x, y, { width: maxWidth });
        } catch {
          doc.fontSize(fontSize).font('Helvetica').text('QR', x, y, { width });
        }
        break;
      }

      case 'divider': {
        const lineWidth = width ?? mmToPt(50);
        doc
          .moveTo(x, y)
          .lineTo(x + lineWidth, y)
          .stroke();
        break;
      }
    }
  }
}

export interface GenerateLabelsPdfOptions {
  paperWidthMm: number;
  paperHeightMm: number;
  fields: LabelField[];
  assets: (AssetData & { id: string })[];
  copiesPerAsset: number;
}

/**
 * Generate a multi-page label PDF and return a Buffer.
 */
export async function generateLabelsPdf(
  options: GenerateLabelsPdfOptions,
): Promise<Buffer> {
  const { paperWidthMm, paperHeightMm, fields, assets, copiesPerAsset } = options;

  const pageWidth = mmToPt(paperWidthMm);
  const pageHeight = mmToPt(paperHeightMm);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pageWidth, pageHeight],
      margin: 0,
      autoFirstPage: false,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const renderAll = async () => {
      let first = true;
      for (const asset of assets) {
        for (let copy = 0; copy < copiesPerAsset; copy++) {
          if (!first) {
            doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
          } else {
            doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });
            first = false;
          }
          await renderFields(doc, fields, asset, { paperWidthMm, paperHeightMm });
        }
      }
      doc.end();
    };

    renderAll().catch(reject);
  });
}

/**
 * Save a PDF buffer to the prints storage directory.
 * Returns the relative URL path.
 */
export function savePrintPdf(printJobId: string, buffer: Buffer): string {
  const dir = path.resolve(STORAGE_PATH, 'prints');
  ensureDir(dir);

  const filePath = path.join(dir, `${printJobId}.pdf`);
  fs.writeFileSync(filePath, buffer);

  return `/uploads/prints/${printJobId}.pdf`;
}

/**
 * Read a print job PDF from storage.
 * Returns the absolute file path or null if not found.
 */
export function getPrintPdfPath(printJobId: string): string | null {
  const filePath = path.resolve(STORAGE_PATH, 'prints', `${printJobId}.pdf`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}
