// Phase 17 v2 / spec §2.3 — Odoo PO PDF parser.
//
// Heuristic, regex-based extraction tuned against the standard Odoo
// Purchase Order PDF template. Accuracy target ~70–90% on that
// template; everything is best-effort and the frontend always lets
// the user review / edit the parsed values before submitting.
//
// Key shape assumptions (from a real Odoo PO sample):
//
//   Shipping address:                ← label
//   <recipient line 1>
//   <recipient line 2>
//   ...
//   <country>
//   <VENDOR NAME>                    ← single short line between blocks
//   Buyer                            ← label
//   <buyer name>
//   Order Date:
//   MM/DD/YYYY
//   Expected Arrival:
//   MM/DD/YYYY
//   Description Qty Unit Price Disc. Taxes Amount   ← header
//   <item rows, possibly multi-line descriptions>
//   Untaxed Amount Rp <number>
//   Non-luxury Good Taxes Rp <number>    ← may be absent
//   Total Rp <number>
//   ...
//   Purchase Order #PO/YYYY/MM/NNNNN
//
// Dates: Odoo prints MM/DD/YYYY by default; we accept dd-month-yyyy
// and ISO too as belt-and-braces.

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
  /** Diagnostic — fields the parser couldn't confidently extract. */
  unparsedFields: string[];
  /** Raw text extracted from the PDF, kept for server-side debugging.
   *  Stripped from the HTTP response by the router. */
  rawText: string;
}

// ── Header-style field extractors ──────────────────────────────────────────
//
// PO number patterns we accept:
//   PO/2026/04/00057
//   #PO/2026/04/00057
//   P.O. 2026-04-00057
//   SP-2026-0001  (internal Wedison numbering)
// Captures the WHOLE identifier including the PO/SP prefix. The Odoo
// PO format has a 3-segment numeric tail (PO/YYYY/MM/NNNNN); Wedison's
// internal SP format has a 2-segment tail (SP-YYYY-NNNN).
const PO_NUMBER_RE =
  /\b(PO[/-]\d{4}[/-]\d{2}[/-]\d{3,}|SP[/-]\d{4}[/-]\d{3,})/i;

const BUYER_LABEL_RE = /^\s*Buyer\s*$/i;
const ORDER_DATE_LABEL_RE = /^\s*Order\s+Date[:.]?\s*$/i;
const EXPECTED_LABEL_RE = /^\s*(?:Expected\s+Arrival|Delivery\s+Date|Receipt\s+Date)[:.]?\s*$/i;
const SHIPPING_LABEL_RE = /^\s*Shipping\s+address[:.]?\s*$/i;

// Date matchers — handle multiple formats.
//   MM/DD/YYYY or DD/MM/YYYY → we try MM/DD first (Odoo default).
//   DD-MM-YYYY  → same
//   YYYY-MM-DD  → ISO
//   "15 May 2026" / "15 Mei 2026" → Date.parse handles English; ID
//   month names get a lookup table fallback.
const ID_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

function normaliseDate(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Numeric with / or -. Odoo defaults to MM/DD/YYYY; we try that
  // first. If month > 12 (impossible) we fall back to DD/MM/YYYY.
  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, aRaw, bRaw, yyyy] = slashMatch;
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
      // Try as MM/DD/YYYY first (Odoo default).
      const mm = String(a).padStart(2, '0');
      const dd = String(b).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) {
      // Fall back to DD/MM/YYYY (EU / ID locale).
      const dd = String(a).padStart(2, '0');
      const mm = String(b).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  // "15 May 2026" / "15 Mei 2026"
  const wordMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (wordMatch) {
    const [, ddRaw, monthRaw, yyyy] = wordMatch;
    const idMonth = ID_MONTHS[monthRaw!.toLowerCase()];
    if (idMonth) {
      const mm = String(idMonth).padStart(2, '0');
      const dd = ddRaw!.padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  // Last-chance Date.parse.
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Normalise a number string that may use either US (1,234.56) or EU
 * (1.234,56) thousand separators. Heuristic: the LAST separator wins
 * as the decimal mark.
 */
function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // Strip currency / unit prefixes (Rp, $, etc.) and trailing %.
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised: string;
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastDot > lastComma) normalised = cleaned.replace(/,/g, '');
    else normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0 && /,\d{1,2}$/.test(cleaned)) {
    // Trailing comma with 1-2 decimals → EU decimal.
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Treat remaining commas as thousand-separators.
    normalised = cleaned.replace(/,/g, '');
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

// ── Locate label-driven fields in the line stream ──────────────────────────
//
// Odoo prints each label on its own line, the value on the next line.
// "Order Date:" then "04/04/2026", etc. Walking the line array beats
// regex against the flat text — it's robust to label re-ordering.

function findValueAfterLabel(
  lines: string[],
  labelRe: RegExp,
  maxLookahead = 3,
): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i]!)) continue;
    for (let j = 1; j <= maxLookahead && i + j < lines.length; j++) {
      const candidate = lines[i + j]!.trim();
      if (candidate.length > 0) return candidate;
    }
  }
  return null;
}

// ── Vendor extraction (spec §2.4 / spec PDF sample) ────────────────────────
//
// In the Odoo PO template, the vendor name appears as a single line
// between the shipping-address block and the "Buyer" label:
//
//   Shipping address:
//   ...customer's address lines...
//   Indonesia
//   Shopee       ← vendor
//   Buyer
//
// We anchor on "Buyer" and walk BACKWARDS to find the first non-empty
// line that doesn't belong to the address block (heuristic: not a
// label, not a recognised country, and not too long).

function extractVendor(lines: string[]): string | null {
  // Find the "Buyer" line.
  let buyerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (BUYER_LABEL_RE.test(lines[i]!)) {
      buyerIdx = i;
      break;
    }
  }
  if (buyerIdx <= 0) return null;

  // Walk backwards: the line right before "Buyer" (skipping blanks)
  // is the vendor in Odoo's layout. Cap at 5 lines back to avoid
  // accidentally hitting the shipping address.
  for (let j = buyerIdx - 1, steps = 0; j >= 0 && steps < 5; j--, steps++) {
    const candidate = lines[j]!.trim();
    if (!candidate) continue;
    // Reject obvious label tokens / country names that sometimes
    // appear right above "Buyer" in a non-vendor layout.
    if (/^(Indonesia|Singapore|Malaysia|Shipping address|Vendor|To)$/i.test(candidate)) {
      continue;
    }
    if (candidate.length > 120) continue;
    return candidate;
  }
  return null;
}

// ── Items table extraction ────────────────────────────────────────────────
//
// Odoo prints the items as space-separated lines:
//
//   Description Qty Unit Price Disc. Taxes Amount
//   Cashier Desk 1.00 Units 3,251,600.00 0.00% Rp 3,251,600.00
//   Miscellaneous
//   Service Fee
//   1.00 Units 4,000.00 0.00% Rp 4,000.00
//
// Description can span multiple lines (the row with numbers is at
// the end of the run). We accumulate non-numeric lines as description
// fragments until we hit a numeric row, then emit one item.
//
// Column heuristic: walking the row tokens left-to-right, we expect
// `[qty] [unit?] [unit_price] [discount%] [tax%]? [amount]`.
// Specifically we take the FIRST number as qty, the SECOND as unit
// price, then the FINAL number as amount, and the 1-2 numbers in
// between as discount / tax (the percent values are < 100, the
// amount value is typically thousands+).

interface NumericRow {
  text: string;
  numbers: number[];
}

function isNumericRow(line: string): NumericRow | null {
  // Tokenise on whitespace. Numbers with comma-thousands separators
  // (e.g. "3,251,600.00") stay as one token because the regex only
  // splits on whitespace, not on commas. parseAmount() handles the
  // separator normalisation downstream.
  const tokens = line.split(/\s+/).filter(Boolean);
  const numbers: number[] = [];
  for (const tok of tokens) {
    // Strip currency/unit/% wrappers before testing.
    if (!/\d/.test(tok)) continue;
    if (/^[A-Za-z]+$/.test(tok)) continue; // "Units", "Rp" etc.
    const n = parseAmount(tok);
    if (n !== null) numbers.push(n);
  }
  // A "real" item row has at least qty + price + amount = 3 numbers.
  if (numbers.length >= 3) return { text: line, numbers };
  return null;
}

function extractItems(rawText: string): ParsedOdooPoItem[] {
  const lines = rawText.split(/\n/);

  // Find the items band.
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Description\b/i.test(lines[i]!)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return [];
  for (let i = startIdx; i < lines.length; i++) {
    if (/Untaxed|Subtotal|Total\s+Amount|Total\s+Taxes|Total\s+Tax\b|^Total\s+Rp|Payment\s+Terms/i.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  const out: ParsedOdooPoItem[] = [];
  const pendingDescription: string[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const numeric = isNumericRow(line);
    if (!numeric) {
      // Description fragment — buffer it.
      pendingDescription.push(line);
      continue;
    }

    // Build the description: any preceding fragments + the non-numeric
    // prefix of this row (e.g. "Cashier Desk" before the numbers).
    const tokens = line.split(/\s+/);
    const descTokens: string[] = [];
    for (const tok of tokens) {
      // Stop at the first token that looks like a number/unit/currency.
      if (
        /^\d/.test(tok) ||
        /^Rp$/i.test(tok) ||
        /^Units?$/i.test(tok) ||
        /^[\d.,]+%?$/.test(tok)
      ) {
        break;
      }
      descTokens.push(tok);
    }
    const inlineDesc = descTokens.join(' ').trim();
    const description = [...pendingDescription, inlineDesc]
      .filter(Boolean)
      .join(' ')
      .trim();
    pendingDescription.length = 0;

    // Map numbers to columns positionally.
    //   First  = qty
    //   Second = unit price
    //   Last   = amount
    //   Middle = discount [, tax]   (in row order — discount first, then tax)
    const ns = numeric.numbers;
    const qty = ns[0] ?? null;
    const unitPrice = ns[1] ?? null;
    const amount = ns[ns.length - 1] ?? null;
    const middle = ns.slice(2, -1); // discount / tax columns
    let discountPercent: number | null = null;
    let taxPercent: number | null = null;
    if (middle.length === 1) {
      // Only one percent-column present. Odoo's column order is
      // Disc | Taxes, so a single value is interpreted as Disc (tax = 0).
      discountPercent = middle[0]!;
    } else if (middle.length >= 2) {
      discountPercent = middle[0]!;
      taxPercent = middle[1]!;
    }

    out.push({
      description: description || line,
      qty,
      unitPrice,
      discountPercent,
      taxPercent,
      amount,
    });
  }

  return out;
}

// ── Totals (Untaxed / Tax / Total) ─────────────────────────────────────────
//
// Odoo prints each total as "<label> Rp <number>" on its own line. We
// match label-anchored regexes that tolerate the "Rp" prefix and the
// thousands-separator number format. The "Non-luxury Good Taxes" label
// is the Odoo Indonesia-specific tax line that lands between Untaxed
// and Total when applicable.

const RP_NUM = '(?:Rp|IDR|USD|SGD|EUR|JPY|MYR|CNY|\\$)?\\s*([\\d.,]+)';
const UNTAXED_RE = new RegExp(`(?:Untaxed\\s+Amount|Subtotal)\\s*${RP_NUM}`, 'i');
const TAX_RE = new RegExp(
  // Match "Non-luxury Good Taxes", "Total Taxes", "Taxes", "Total Tax".
  `(?:Non[-\\s]?luxury\\s+Good\\s+Taxes|Total\\s+Taxes|Total\\s+Tax|\\bTaxes)\\s*${RP_NUM}`,
  'i',
);
const TOTAL_RE = new RegExp(
  // Anchored on the standalone "Total" label (avoid matching "Total Taxes").
  `(?:^|\\n)\\s*(?:Total|Amount\\s+Due)\\s+${RP_NUM}`,
  'im',
);

// ── Currency detection ────────────────────────────────────────────────────
//
// Odoo PO Indonesia uses "Rp" as the symbol but doesn't print the ISO
// code. We map symbols → ISO and also recognise explicit codes.

const CURRENCY_CODE_RE = /\b(IDR|USD|SGD|EUR|JPY|MYR|CNY|GBP|AUD)\b/;

function detectCurrency(text: string): string | null {
  const codeMatch = CURRENCY_CODE_RE.exec(text)?.[1];
  if (codeMatch) return codeMatch;
  if (/\bRp\b/.test(text)) return 'IDR';
  if (/(?:^|\s)\$/.test(text)) return 'USD';
  if (/€/.test(text)) return 'EUR';
  if (/¥/.test(text)) return 'JPY';
  return null;
}

// ── Main entry ────────────────────────────────────────────────────────────

export async function parseOdooPoPdf(buffer: Buffer): Promise<ParsedOdooPo> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let text = '';
  try {
    const result = await parser.getText();
    text = result.text ?? '';
  } finally {
    await parser.destroy();
  }

  const lines = text.split(/\n/).map((l) => l.trim());
  const unparsed: string[] = [];

  // PO number — pattern is unambiguous in the text body.
  const poNumber = PO_NUMBER_RE.exec(text)?.[1] ?? null;
  if (!poNumber) unparsed.push('poNumber');

  // Order date + Expected arrival are label-on-own-line in Odoo.
  const orderRaw = findValueAfterLabel(lines, ORDER_DATE_LABEL_RE);
  const orderDate = orderRaw ? normaliseDate(orderRaw) : null;
  if (!orderDate) unparsed.push('orderDate');

  const expectedRaw = findValueAfterLabel(lines, EXPECTED_LABEL_RE);
  const expectedArrival = expectedRaw ? normaliseDate(expectedRaw) : null;
  if (!expectedArrival) unparsed.push('expectedArrival');

  // Buyer comes right after the "Buyer" label.
  const buyer = findValueAfterLabel(lines, BUYER_LABEL_RE);
  if (!buyer) unparsed.push('buyer');

  const vendor = extractVendor(lines);
  if (!vendor) unparsed.push('vendor');

  const currency = detectCurrency(text);
  if (!currency) unparsed.push('currency');

  const untaxedRaw = UNTAXED_RE.exec(text)?.[1];
  const untaxedAmount = untaxedRaw ? parseAmount(untaxedRaw) : null;
  if (untaxedAmount === null) unparsed.push('untaxedAmount');

  const taxRaw = TAX_RE.exec(text)?.[1];
  // Tax line is often ABSENT (no PPN/luxury surcharge); when absent we
  // default to 0 rather than flagging — that matches the Odoo "blank
  // tax cell" reality.
  const totalTaxes = taxRaw ? parseAmount(taxRaw) : 0;

  const totalRaw = TOTAL_RE.exec(text)?.[1];
  const totalAmount = totalRaw ? parseAmount(totalRaw) : null;
  if (totalAmount === null) unparsed.push('totalAmount');

  const items = extractItems(text);
  if (items.length === 0) unparsed.push('items');

  // Suppress shipping-address noise: vendor === shipping recipient name
  // is a sign our heuristic walked into the address block. The
  // shipping-address block's first line is the recipient — flag it as
  // unparsed so the UI prompts the user.
  if (vendor) {
    const shippingIdx = lines.findIndex((l) => SHIPPING_LABEL_RE.test(l));
    if (shippingIdx >= 0 && shippingIdx + 1 < lines.length) {
      const recipient = lines[shippingIdx + 1]!.trim();
      if (recipient && recipient.toLowerCase() === vendor.toLowerCase()) {
        unparsed.push('vendor');
      }
    }
  }

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
    unparsedFields: Array.from(new Set(unparsed)),
    rawText: text,
  };
}
