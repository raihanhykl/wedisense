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
 *
 * Encodes the asset's detail-page URL so a phone-camera scan lands directly
 * on /admin/assets/{id}. Earlier versions encoded `/assets/{id}` (without
 * the admin prefix) which is a 404 in this app — the scan page's
 * ASSET_URL_PATTERN accepts both shapes so already-printed legacy QR codes
 * keep working. Re-printing labels after this change yields the correct URL.
 */
export async function generateQrCode(assetId: string): Promise<string> {
  const dir = path.resolve(STORAGE_PATH, 'qrcodes');
  ensureDir(dir);

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
  const qrBuffer: Buffer = await QRCode.toBuffer(
    `${appUrl}/admin/assets/${assetId}`,
    {
      type: 'png',
      width: 300,
    },
  );

  const filePath = path.join(dir, `${assetId}.png`);
  fs.writeFileSync(filePath, qrBuffer);

  return `/uploads/qrcodes/${assetId}.png`;
}

/**
 * QR code for a Location. Encodes the location's detail-page URL so a
 * mobile scan lands directly on /admin/locations/{id}. Stored under a
 * `locations/` subdirectory to keep the assets and locations namespaces
 * separate (so re-issuing one type doesn't accidentally clobber another).
 */
export async function generateLocationQrCode(locationId: string): Promise<string> {
  const dir = path.resolve(STORAGE_PATH, 'qrcodes', 'locations');
  ensureDir(dir);

  const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
  const qrBuffer: Buffer = await QRCode.toBuffer(
    `${appUrl}/admin/locations/${locationId}`,
    {
      type: 'png',
      width: 300,
    },
  );

  const filePath = path.join(dir, `${locationId}.png`);
  fs.writeFileSync(filePath, qrBuffer);

  return `/uploads/qrcodes/locations/${locationId}.png`;
}
