import bwipjs from 'bwip-js';
import fs from 'fs';
import path from 'path';

// qrcode has no type declarations — we declare the module here
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as {
  toBuffer: (text: string, opts?: Record<string, unknown>) => Promise<Buffer>;
};

const STORAGE_PATH = process.env['STORAGE_PATH'] ?? './uploads';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a Code128 barcode PNG and save to disk.
 * Returns the relative URL path for serving.
 */
export async function generateBarcode(assetId: string, assetNumber: string): Promise<string> {
  const dir = path.resolve(STORAGE_PATH, 'barcodes');
  ensureDir(dir);

  const pngBuffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: assetNumber,
    scale: 3,
    height: 10,
    includetext: true,
  });

  const filePath = path.join(dir, `${assetId}.png`);
  fs.writeFileSync(filePath, pngBuffer);

  return `/uploads/barcodes/${assetId}.png`;
}

/**
 * Generate a QR code PNG and save to disk.
 * Returns the relative URL path for serving.
 */
export async function generateQrCode(assetId: string): Promise<string> {
  const dir = path.resolve(STORAGE_PATH, 'qrcodes');
  ensureDir(dir);

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
  const qrBuffer: Buffer = await QRCode.toBuffer(`${appUrl}/assets/${assetId}`, {
    type: 'png',
    width: 300,
  });

  const filePath = path.join(dir, `${assetId}.png`);
  fs.writeFileSync(filePath, qrBuffer);

  return `/uploads/qrcodes/${assetId}.png`;
}
