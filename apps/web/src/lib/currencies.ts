// Phase 17 v2 — currency registry for procurement forms.
//
// Spec §2.2: a dropdown of supported currencies (IDR, USD, SGD, …) and
// live formatting on the amount input. Each entry carries the locale +
// fraction-digits we use with Intl.NumberFormat so an IDR 1.500.000
// renders correctly next to a USD 1,500.00. "Code" is the ISO 4217
// string we round-trip with the backend.

export interface CurrencyDef {
  code: string;
  label: string;
  /** BCP-47 locale we feed to Intl.NumberFormat. */
  locale: string;
  /** Decimal places used at the input + display layer. IDR rarely shows
   *  sen so we keep 0; USD/SGD show 2. */
  fractionDigits: number;
}

// Top of the list is the default for new POs (spec implies IDR default
// for Wedison). Add new ISO codes here as they're needed — the dropdown
// always lists them in this order.
export const SUPPORTED_CURRENCIES: CurrencyDef[] = [
  { code: "IDR", label: "Rupiah (IDR)", locale: "id-ID", fractionDigits: 0 },
  { code: "USD", label: "US Dollar (USD)", locale: "en-US", fractionDigits: 2 },
  { code: "SGD", label: "Singapore Dollar (SGD)", locale: "en-SG", fractionDigits: 2 },
  { code: "EUR", label: "Euro (EUR)", locale: "en-IE", fractionDigits: 2 },
  { code: "JPY", label: "Japanese Yen (JPY)", locale: "ja-JP", fractionDigits: 0 },
  { code: "MYR", label: "Malaysian Ringgit (MYR)", locale: "ms-MY", fractionDigits: 2 },
  { code: "CNY", label: "Chinese Yuan (CNY)", locale: "zh-CN", fractionDigits: 2 },
];

const CURRENCY_BY_CODE = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c]));

export const DEFAULT_CURRENCY: CurrencyDef = SUPPORTED_CURRENCIES[0]!;

/**
 * Resolve a currency code to its definition. Returns a synthesised
 * entry for unknown codes so a stray "XYZ" in old data still renders
 * sensibly (Intl.NumberFormat accepts any ISO-4217-like string).
 */
export function getCurrency(code: string | null | undefined): CurrencyDef {
  if (!code) return DEFAULT_CURRENCY;
  const upper = code.toUpperCase();
  return (
    CURRENCY_BY_CODE.get(upper) ?? {
      code: upper,
      label: upper,
      locale: "en-US",
      fractionDigits: 2,
    }
  );
}
