export interface EanLookupResult {
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  imageUrl: string | null;
  source: 'API_UPCITEMDB' | 'API_BARCODELOOKUP' | 'MANUAL';
  rawApiResponse: Record<string, unknown> | null;
}
