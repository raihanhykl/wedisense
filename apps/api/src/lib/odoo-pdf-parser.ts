// Phase 17 v2 / spec §2.3 — Odoo PO PDF parser.
//
// Heuristic, regex-based extraction. Accuracy target ~70-90% on the
// standard Odoo PO template; everything is best-effort and the
// frontend always lets the user review / edit the parsed values
// before submitting.
//
// We deliberately don't try to be clever about table layout — Odoo
// PDFs vary across versions and tax presets. The parser captures
// what it can confidently identify and leaves nulls for the rest;
// the UI surfaces a "Review parsed fields" banner so the user knows
// which cells need manual touch-up.

import { PDFParse } from 'pdf-parse';

export interface ParsedOdooPoItem {
  /** Free-text product description from the PDF's Description column. */
  description: string;
  qty: number | null;
  unitPrice: number | null;
  discountPercent: number | null;
  taxPercent: number | null;
  amount: number | null;
}

export interface ParsedOdooPo {
  poNumber: string | null;
  vendor: string | null;
  buyer: string | null;
  orderDate: string | null;          // ISO yyyy-mm-dd
  expectedArrival: string | null;    // ISO yyyy-mm-dd
  currency: string | null;
  items: ParsedOdooPoItem[];
  untaxedAmount: number | null;
  totalTaxes: number | null;
  totalAmount: number | null;
  /** Diagnostic — fields the parser couldn't confidently extract.
   *  Surfaced in the UI banner so users know what needs manual edit. */
  unparsedFields: string[];
  /** Raw text extracted from the PDF, kept for debugging + future
   *  refinements. NOT shown in the UI by default. */
  rawText: string;
}

// ── Field extractors ───────────────────────────────────────────────────────

const PO_NUMBER_RE = /\b(?:PO|P\.O\.|P\.O\.?\s*No\.?|SP)[\s:#]*([A-Z]?\d{4}[/\-]\d{2}[/\-]\d{3,})/i;
const ORDER_DATE_RE = /Order\s+Date[:\s]+([\d]{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const EXPECTED_RE = /(?:Expected\s+Arrival|Delivery\s+Date|Receipt\s+Date)[:\s]+([\d]{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;
const BUYER_RE = /(?:Buyer|Purchase\s+Representative|Purchaser)[:\s]+([A-Za-z][^\n]{1,80})/i;
// Odoo prints "Currency: IDR" or shows it inline; both forms covered.
const CURRENCY_RE = /\b(IDR|USD|SGD|EUR|JPY|MYR|CNY|GBP|AUD)\b/;
// Totals — Odoo's English labels.
const UNTAXED_RE = /(?:Untaxed\s+Amount|Subtotal)[:\s]*([\d.,]+)/i;
const TAX_RE = /(?:Total\s+Taxes|Taxes|Total\s+Tax)[:\s]*([\d.,]+)/i;
const TOTAL_RE = /(?:Total(?:\s+Amount)?|Amount\s+Due)[:\s]*([\d.,]+)/i;

/**
 * Normalise a number string that may use either US (1,234.56) or EU
 * (1.234,56) thousand separators. Heuristic: the LAST separator wins
 * as the decimal mark (matches what humans read).
 */
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present — the rightmost is the decimal mark.
    if (lastDot > lastComma) {
      normalised = cleaned.replace(/,/g, '');
    } else {
      normalised = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma >= 0) {
    // Only comma — decimal in EU style.
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned;
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a date-ish string into ISO yyyy-mm-dd. Returns null when we
 * can't make sense of the input. Date.parse handles "15 May 2026" and
 * "2026-05-15" natively; "15/05/2026" we coerce manually.
 */
function normaliseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // dd/mm/yyyy or dd-mm-yyyy → reorder to yyyy-mm-dd
  const dmYyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmYyyy) {
    const dd = dmYyyy[1]!.padStart(2, '0');
    const mm = dmYyyy[2]!.padStart(2, '0');
    return `${dmYyyy[3]}-${mm}-${dd}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // Format as yyyy-mm-dd in UTC to avoid TZ drift.
  return parsed.toISOString().slice(0, 10);
}

// ── Item table extraction ──────────────────────────────────────────────────
//
// Odoo's PDF layout dumps the items table as line-broken text. After
// pdf-parse the typical shape is:
//   Description text  10  8,500,000.00  0  11  93,500,000
// We walk every line and pick out the ones that LOOK like item rows:
// non-empty, end with several numeric tokens, and have ≥3 numbers
// (qty + price + amount at minimum). Discount + tax columns may be
// absent on simpler PO templates — we default them to 0.

interface NumericRow {
  text: string;
  numbers: number[];
}

function extractNumericRows(text: string): NumericRow[] {
  const out: NumericRow[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Tokenize on whitespace AFTER replacing thousands-separator commas
    // inside numbers with sentinel — otherwise "1,000.00" splits into
    // "1," + "000.00". Heuristic: a comma flanked by digits on both
    // sides is a thousands separator.
    const protectedLine = line.replace(/(\d),(\d)/g, '$1$2');
    const tokens = protectedLine.split(/\s+/);
    const numbers: number[] = [];
    for (const tok of tokens) {
      const restored = tok.replace(//g, ',');
      const n = parseAmount(restored);
      // Reject tokens that are clearly NOT numbers (single digits next
      // to letters etc.). parseAmount returns null in that case.
      if (n !== null && /[\d]/.test(restored) && !/^[A-Za-z]/.test(restored)) {
        numbers.push(n);
      }
    }
    if (numbers.length >= 3 && line.length < 300) {
      out.push({ text: line, numbers });
    }
  }
  return out;
}

/**
 * Heuristically pick out item rows from a list of numeric-bearing
 * lines. Strategy:
 *   - Find the item-table band by looking for a "Description" header
 *     and consuming subsequent rows until we hit a totals label
 *     (Untaxed Amount / Subtotal / Total).
 *   - Within the band, treat every numeric row with ≥3 numbers as an
 *     item line.
 *   - Last number is treated as the line Amount; the second-to-last
 *     as Tax % (if it looks like a percent — i.e. < 100 and integer-
 *     ish); etc.
 *
 * This is fragile and we accept it. Per-row confidence is reported
 * via the unparsedFields list so the UI can highlight rows the user
 * needs to verify.
 */
function extractItems(rawText: string): ParsedOdooPoItem[] {
  const lines = rawText.split(/\n+/);
  // Locate the start: the row containing "Description" header.
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Description\b/i.test(lines[i]!)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return [];
  // Locate the end: first line that mentions Untaxed / Subtotal / Total.
  for (let i = startIdx; i < lines.length; i++) {
    if (/Untaxed|Subtotal|Total\s+Amount|Total\s+Taxes/i.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  const band = lines.slice(startIdx, endIdx).join('\n');
  const rows = extractNumericRows(band);

  return rows.map((row) => {
    const ns = row.numbers;
    // Heuristics on the trailing numbers:
    //   amount = last number
    //   tax = previous number IF it looks like a percent (0..100, often int)
    //   discount = the one before tax IF it looks like a percent
    //   qty = first number when there are ≥4 numbers (else null)
    //   unitPrice = second number when there are ≥4 numbers
    const amount = ns[ns.length - 1] ?? null;
    let taxPercent: number | null = null;
    let discountPercent: number | null = null;
    let qty: number | null = null;
    let unitPrice: number | null = null;

    if (ns.length >= 4) {
      qty = ns[0]!;
      unitPrice = ns[1]!;
      // Heuristic: if the second-to-last is < 100 AND integer-ish, treat
      // it as tax%; the one before THAT as discount%.
      const maybeTax = ns[ns.length - 2];
      if (maybeTax !== undefined && maybeTax >= 0 && maybeTax <= 100) {
        taxPercent = maybeTax;
        const maybeDiscount = ns[ns.length - 3];
        if (
          maybeDiscount !== undefined &&
          maybeDiscount >= 0 &&
          maybeDiscount <= 100
        ) {
          discountPercent = maybeDiscount;
        }
      }
    } else if (ns.length === 3) {
      // qty + price + amount (no discount/tax)
      qty = ns[0]!;
      unitPrice = ns[1]!;
    }

    // Description = the row text with the trailing numeric tokens
    // stripped off. Conservative: drop the tail until we hit the first
    // non-numeric token.
    const tokens = row.text.split(/\s+/);
    while (tokens.length > 0) {
      const last = tokens[tokens.length - 1]!;
      // A numeric-looking token ends with digits + maybe % sign.
      if (/^[\d.,%]+$/.test(last)) tokens.pop();
      else break;
    }
    const description = tokens.join(' ').trim();

    return {
      description: description || row.text,
      qty,
      unitPrice,
      discountPercent,
      taxPercent,
      amount,
    };
  });
}

// ── Vendor extraction ─────────────────────────────────────────────────────
//
// Odoo's PO PDF typically shows the vendor block near the top, often
// just below the header. The first non-empty line that's NOT a
// recognised header label is a strong candidate. We also exclude
// lines that look like dates or short codes.

function extractVendor(text: string): string | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Skip the first 1-3 lines (usually company logo / heading).
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i]!;
    if (
      /^(Order\s+Date|Expected|Buyer|Purchase|Reference|Currency|Description|PO\b)/i.test(
        line,
      )
    )
      continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) continue;
    if (line.length < 3 || line.length > 120) continue;
    // First line that contains letters AND isn't a label-ish keyword.
    if (/[A-Za-z]{3,}/.test(line)) return line;
  }
  return null;
}

// ── Main entry ────────────────────────────────────────────────────────────

export async function parseOdooPoPdf(buffer: Buffer): Promise<ParsedOdooPo> {
  // pdf-parse v2 exposes a class-based API: instantiate with the
  // document buffer (Buffer is auto-converted to Uint8Array) and call
  // getText() for the flat text result.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let text = '';
  try {
    const result = await parser.getText();
    text = result.text ?? '';
  } finally {
    await parser.destroy();
  }

  const unparsed: string[] = [];

  const poNumber = PO_NUMBER_RE.exec(text)?.[1] ?? null;
  if (!poNumber) unparsed.push('poNumber');

  const orderDateRaw = ORDER_DATE_RE.exec(text)?.[1];
  const orderDate = orderDateRaw ? normaliseDate(orderDateRaw) : null;
  if (!orderDate) unparsed.push('orderDate');

  const expectedRaw = EXPECTED_RE.exec(text)?.[1];
  const expectedArrival = expectedRaw ? normaliseDate(expectedRaw) : null;
  if (!expectedArrival) unparsed.push('expectedArrival');

  const buyer = BUYER_RE.exec(text)?.[1]?.trim() ?? null;
  if (!buyer) unparsed.push('buyer');

  const vendor = extractVendor(text);
  if (!vendor) unparsed.push('vendor');

  const currency = CURRENCY_RE.exec(text)?.[1] ?? null;
  if (!currency) unparsed.push('currency');

  const untaxedAmount = (() => {
    const raw = UNTAXED_RE.exec(text)?.[1];
    return raw ? parseAmount(raw) : null;
  })();
  if (untaxedAmount === null) unparsed.push('untaxedAmount');

  const totalTaxes = (() => {
    const raw = TAX_RE.exec(text)?.[1];
    return raw ? parseAmount(raw) : null;
  })();
  if (totalTaxes === null) unparsed.push('totalTaxes');

  const totalAmount = (() => {
    const raw = TOTAL_RE.exec(text)?.[1];
    return raw ? parseAmount(raw) : null;
  })();
  if (totalAmount === null) unparsed.push('totalAmount');

  const items = extractItems(text);
  if (items.length === 0) unparsed.push('items');

  return {
    poNumber,
    vendor,
    buyer,
    orderDate,
    expectedArrival,
    currency,
    items,
    untaxedAmount,
    totalTaxes,
    totalAmount,
    unparsedFields: unparsed,
    rawText: text,
  };
}
