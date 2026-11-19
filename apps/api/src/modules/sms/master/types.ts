/** Shaped row returned by vehicle-model list / detail queries. */
export interface VehicleModelRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  variantCount: number;
  unitCount: number;
}

/** Shaped row returned by vehicle-variant list / detail queries. */
export interface VehicleVariantRow {
  id: string;
  modelId: string;
  name: string;
  batteryVariant: string | null;
  color: string;
  colorHex: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  model: { id: string; code: string; name: string };
  unitCount: number;
}
