export interface EditorField {
  id: string;
  type: "barcode" | "qr_code" | "text" | "field" | "divider";
  field_key?: string; // For barcode/qr_code: which asset field to encode. For field: which asset field to display
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number; // For barcode/qr_code
  font_size?: number;
  bold?: boolean;
  custom_value?: string;
}

export interface EditorState {
  name: string;
  description: string;
  paperWidthMm: number;
  paperHeightMm: number;
  isDefault: boolean;
  fields: EditorField[];
  selectedFieldId: string | null;
}

export interface PreviewAsset {
  id: string;
  assetNumber: string;
  name: string;
  serialNumber: string | null;
  location: string;
  assignedTo: string | null;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
}

export const ASSET_FIELD_OPTIONS = [
  { key: "asset_number", label: "Asset Number" },
  { key: "serial_number", label: "Serial Number" },
  { key: "name", label: "Asset Name" },
  { key: "location", label: "Location" },
  { key: "assigned_to", label: "Assigned To" },
  { key: "purchase_date", label: "Purchase Date" },
  { key: "warranty_end_date", label: "Warranty End Date" },
] as const;

export const FIELD_TYPE_OPTIONS = [
  { type: "barcode" as const, label: "Barcode", icon: "|||" },
  { type: "qr_code" as const, label: "QR Code", icon: "#" },
  { type: "text" as const, label: "Text", icon: "Aa" },
  { type: "field" as const, label: "Asset Field", icon: "F" },
  { type: "divider" as const, label: "Divider", icon: "--" },
] as const;
