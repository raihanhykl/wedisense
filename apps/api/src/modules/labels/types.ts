import type { PrismaClient } from '@prisma/client';

/** Transaction client type for use inside $transaction callbacks */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Fields stored in the LabelTemplate JSON column */
export interface LabelField {
  type: 'barcode' | 'qr_code' | 'text' | 'field' | 'divider';
  field_key?: string;
  label?: string;
  x: number; // mm
  y: number; // mm
  width?: number; // mm
  font_size?: number;
  bold?: boolean;
  custom_value?: string;
}

/** Asset data passed to PDF generation */
export interface AssetData {
  assetNumber: string;
  serialNumber: string | null;
  name: string;
  location: string;
  assignedTo: string | null;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  barcodeImageUrl: string | null;
}
