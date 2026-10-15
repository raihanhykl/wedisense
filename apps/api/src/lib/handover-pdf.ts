import fs from 'fs';
import PDFDocument from 'pdfkit';
import handoverCopy from '@wedisense/shared/locales/id/handover.json';

// `qrcode` ships no type declarations; same require-shim as lib/pdf.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as {
  toBuffer: (text: string, opts?: Record<string, unknown>) => Promise<Buffer>;
};

/**
 * Document copy is always Indonesian regardless of the operator's UI
 * language: this is an internal legal record signed by Indonesian staff,
 * and a bilingual archive would be worse than a consistent one. The strings
 * live in the shared locale package (mirrored in `en/handover.json`) rather
 * than inline so they stay reviewable by non-developers and are ready to
 * flow through i18next once the frontend wiring lands.
 */
const COPY = handoverCopy.document;

// ── Page geometry (points; A4 = 595.28 × 841.89) ────────────────────────────
const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const CONTENT_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN;
// Reserved strip at the foot of every page for the form number + page count.
const FOOTER_HEIGHT = 34;
const BODY_BOTTOM = CONTENT_BOTTOM - FOOTER_HEIGHT;

const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

export type HandoverPdfType =
  | 'COMPANY_TO_EMPLOYEE'
  | 'EMPLOYEE_TO_EMPLOYEE'
  | 'EMPLOYEE_TO_COMPANY';

export interface HandoverPdfCompany {
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** Absolute path to a PNG/JPEG logo, already verified to exist. */
  logoAbsolutePath: string | null;
}

export interface HandoverPdfParty {
  name: string;
  employeeId: string | null;
  locationName: string | null;
}

export interface HandoverPdfItem {
  assetNumber: string;
  assetName: string;
  serialNumber: string | null;
  condition: string;
  itemNotes: string | null;
}

export interface HandoverPdfData {
  formNumber: string;
  handoverType: HandoverPdfType;
  handoverDate: Date;
  company: HandoverPdfCompany;
  /** Null when the company itself is the handing-over party. */
  firstParty: HandoverPdfParty | null;
  /** Null when the company itself is the receiving party. */
  secondParty: HandoverPdfParty | null;
  itOfficer: HandoverPdfParty;
  acknowledgedBy: HandoverPdfParty | null;
  purpose: string | null;
  notes: string | null;
  items: HandoverPdfItem[];
  /** Deep link encoded into the footer QR; omitted when unavailable. */
  qrUrl: string | null;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Builds "Rabu" / "12 Agustus 2026" from explicit name tables rather than
 * `Intl.DateTimeFormat('id-ID')`: Node builds compiled with small-icu fall
 * back to English month names, which would silently anglicise every
 * document on a host we don't control.
 */
function formatIndonesianDate(date: Date): { day: string; date: string } {
  const dayName = COPY.days[date.getDay()] ?? '';
  const monthName = COPY.months[date.getMonth()] ?? '';
  return {
    day: dayName,
    date: `${date.getDate()} ${monthName} ${date.getFullYear()}`,
  };
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function translateCondition(condition: string): string {
  const map = COPY.condition as Record<string, string | undefined>;
  return map[condition] ?? condition;
}

/** Joins the non-empty parts of a postal address into one line. */
function formatCompanyAddress(company: HandoverPdfCompany): string {
  const cityLine = [company.city, company.province, company.postalCode]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
  return [company.address, cityLine]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
}

function formatCompanyContact(company: HandoverPdfCompany): string {
  return [company.phone, company.email, company.website]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');
}

// ── Section renderers ───────────────────────────────────────────────────────

function drawLetterhead(doc: PDFKit.PDFDocument, company: HandoverPdfCompany): void {
  const top = PAGE_MARGIN;
  let textLeft = PAGE_MARGIN;
  let logoBottom = top;

  if (company.logoAbsolutePath) {
    try {
      const logoSize = 52;
      // `fit` alone left-/top-aligns within the box, which is what we want;
      // pdfkit's align/valign options only accept center/right/bottom.
      doc.image(company.logoAbsolutePath, PAGE_MARGIN, top, {
        fit: [logoSize, logoSize],
      });
      textLeft = PAGE_MARGIN + logoSize + 12;
      logoBottom = top + logoSize;
    } catch {
      // A corrupt or unreadable logo must never block issuing the document —
      // fall through to a text-only letterhead.
      textLeft = PAGE_MARGIN;
    }
  }

  const textWidth = PAGE_WIDTH - PAGE_MARGIN - textLeft;

  doc.font(FONT_BOLD).fontSize(15).text(company.name.toUpperCase(), textLeft, top, {
    width: textWidth,
  });

  const address = formatCompanyAddress(company);
  if (address) {
    doc.font(FONT).fontSize(8.5).text(address, textLeft, doc.y + 1, { width: textWidth });
  }
  const contact = formatCompanyContact(company);
  if (contact) {
    doc.font(FONT).fontSize(8.5).text(contact, textLeft, doc.y + 1, { width: textWidth });
  }

  const ruleY = Math.max(doc.y, logoBottom) + 8;
  doc
    .lineWidth(1.5)
    .moveTo(PAGE_MARGIN, ruleY)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, ruleY)
    .stroke();

  doc.y = ruleY + 16;
}

function drawTitle(doc: PDFKit.PDFDocument, formNumber: string): void {
  doc.font(FONT_BOLD).fontSize(13).text(COPY.title, PAGE_MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: 'center',
  });
  doc
    .font(FONT)
    .fontSize(10)
    .text(`${COPY.numberLabel}: ${formNumber}`, PAGE_MARGIN, doc.y + 2, {
      width: CONTENT_WIDTH,
      align: 'center',
    });
  doc.y += 14;
}

/** Renders a "Label : value" row inside a party block. */
function drawLabelledRow(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const labelWidth = 72;
  const y = doc.y;
  doc.font(FONT).fontSize(9.5);
  doc.text(label, PAGE_MARGIN + 12, y, { width: labelWidth });
  doc.text(':', PAGE_MARGIN + 12 + labelWidth, y, { width: 8 });
  doc.text(value, PAGE_MARGIN + 12 + labelWidth + 10, y, {
    width: CONTENT_WIDTH - labelWidth - 34,
  });
}

function drawParty(
  doc: PDFKit.PDFDocument,
  heading: string,
  party: HandoverPdfParty | null,
  companyName: string,
): void {
  doc.font(FONT_BOLD).fontSize(9.5).text(heading, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.y += 2;

  if (!party) {
    // The company side of the transaction — no NIK, no personal location.
    drawLabelledRow(doc, COPY.fields.name, companyName);
    doc.y += 8;
    return;
  }

  drawLabelledRow(doc, COPY.fields.name, party.name);
  if (party.employeeId) {
    drawLabelledRow(doc, COPY.fields.employeeId, party.employeeId);
  }
  if (party.locationName) {
    drawLabelledRow(doc, COPY.fields.location, party.locationName);
  }
  doc.y += 8;
}

// ── Asset table ─────────────────────────────────────────────────────────────

// Widths sum to CONTENT_WIDTH (495.28) so the table spans the text block
// exactly. Remarks get their own column rather than being folded into the
// asset name, where "(scratched casing)" would read as part of the product.
const TABLE_COLUMNS = [
  { header: COPY.table.no, width: 26, align: 'center' as const },
  { header: COPY.table.assetNumber, width: 112, align: 'left' as const },
  { header: COPY.table.assetName, width: 132, align: 'left' as const },
  { header: COPY.table.serialNumber, width: 92, align: 'left' as const },
  { header: COPY.table.condition, width: 52, align: 'center' as const },
  { header: COPY.table.itemNotes, width: 81.28, align: 'left' as const },
];

const TABLE_FONT_SIZE = 8.5;
const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 4;

function tableRowHeight(doc: PDFKit.PDFDocument, cells: string[]): number {
  doc.font(FONT).fontSize(TABLE_FONT_SIZE);
  let tallest = 0;
  cells.forEach((text, index) => {
    const column = TABLE_COLUMNS[index];
    if (!column) return;
    const height = doc.heightOfString(text || '-', {
      width: column.width - CELL_PADDING_X * 2,
    });
    tallest = Math.max(tallest, height);
  });
  return tallest + CELL_PADDING_Y * 2;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  y: number,
  height: number,
  bold: boolean,
): void {
  let x = PAGE_MARGIN;
  doc.font(bold ? FONT_BOLD : FONT).fontSize(TABLE_FONT_SIZE);

  cells.forEach((text, index) => {
    const column = TABLE_COLUMNS[index];
    if (!column) return;
    doc.lineWidth(0.6).rect(x, y, column.width, height).stroke();
    doc.text(text || '-', x + CELL_PADDING_X, y + CELL_PADDING_Y, {
      width: column.width - CELL_PADDING_X * 2,
      align: column.align,
    });
    x += column.width;
  });
}

function drawAssetTable(doc: PDFKit.PDFDocument, items: HandoverPdfItem[]): void {
  const headerCells = TABLE_COLUMNS.map((c) => c.header);
  const headerHeight = tableRowHeight(doc, headerCells);

  let y = doc.y;
  drawTableRow(doc, headerCells, y, headerHeight, true);
  y += headerHeight;

  items.forEach((item, index) => {
    const cells = [
      String(index + 1),
      item.assetNumber,
      item.assetName,
      item.serialNumber ?? '-',
      translateCondition(item.condition),
      item.itemNotes ?? '-',
    ];
    const height = tableRowHeight(doc, cells);

    // Break before the row rather than letting a cell straddle the footer,
    // then repeat the header so a continued table stays readable.
    if (y + height > BODY_BOTTOM) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawTableRow(doc, headerCells, y, headerHeight, true);
      y += headerHeight;
    }

    drawTableRow(doc, cells, y, height, false);
    y += height;
  });

  doc.y = y + 12;
}

// ── Signatures ──────────────────────────────────────────────────────────────

interface SignatureBlock {
  label: string;
  name: string | null;
}

/**
 * Resolves who occupies each of the four signature blocks. The handing-over
 * and receiving roles swap between the employee and the IT officer depending
 * on direction — for a company-to-employee issue, IT signs as the company's
 * hand; for a return, IT signs as the company's receiver.
 */
function buildSignatureBlocks(data: HandoverPdfData): SignatureBlock[] {
  const handedOverBy =
    data.handoverType === 'COMPANY_TO_EMPLOYEE' ? data.itOfficer : data.firstParty;
  const receivedBy =
    data.handoverType === 'EMPLOYEE_TO_COMPANY' ? data.itOfficer : data.secondParty;

  return [
    { label: COPY.signatures.handedOverBy, name: handedOverBy?.name ?? null },
    { label: COPY.signatures.receivedBy, name: receivedBy?.name ?? null },
    { label: COPY.signatures.itOfficer, name: data.itOfficer.name },
    // Rendered even when nobody is assigned: the printed form then carries a
    // blank line a supervisor can sign by hand.
    { label: COPY.signatures.acknowledgedBy, name: data.acknowledgedBy?.name ?? null },
  ];
}

const SIGNATURE_BLOCK_HEIGHT = 92;
const SIGNATURE_GRID_HEIGHT = SIGNATURE_BLOCK_HEIGHT * 2;

function drawSignatures(doc: PDFKit.PDFDocument, data: HandoverPdfData): void {
  // Signatures must never be orphaned onto a page of their own with no
  // context, nor split across a page break.
  if (doc.y + SIGNATURE_GRID_HEIGHT > BODY_BOTTOM) {
    doc.addPage();
  }

  const blocks = buildSignatureBlocks(data);
  const columnWidth = CONTENT_WIDTH / 2;
  const top = doc.y;

  blocks.forEach((block, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE_MARGIN + column * columnWidth;
    const y = top + row * SIGNATURE_BLOCK_HEIGHT;

    doc.font(FONT).fontSize(9.5).text(block.label, x, y, {
      width: columnWidth - 20,
      align: 'left',
    });

    // Signature line sits well below the label, leaving room for a wet
    // signature and any company stamp.
    const lineY = y + SIGNATURE_BLOCK_HEIGHT - 26;
    doc
      .lineWidth(0.6)
      .moveTo(x, lineY)
      .lineTo(x + columnWidth - 40, lineY)
      .stroke();

    doc
      .font(FONT)
      .fontSize(9.5)
      .text(block.name ? `( ${block.name} )` : '(                                        )', x, lineY + 4, {
        width: columnWidth - 40,
        align: 'left',
      });
  });

  doc.y = top + SIGNATURE_GRID_HEIGHT;
}

// ── Footer ──────────────────────────────────────────────────────────────────

function drawFooters(
  doc: PDFKit.PDFDocument,
  formNumber: string,
  qrBuffer: Buffer | null,
): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);

    const footerTop = CONTENT_BOTTOM - FOOTER_HEIGHT + 8;
    doc
      .lineWidth(0.5)
      .moveTo(PAGE_MARGIN, footerTop)
      .lineTo(PAGE_WIDTH - PAGE_MARGIN, footerTop)
      .stroke();

    const qrSize = 22;
    const textWidth = CONTENT_WIDTH - (qrBuffer ? qrSize + 8 : 0);

    doc.font(FONT).fontSize(7.5).text(formNumber, PAGE_MARGIN, footerTop + 6, {
      width: textWidth,
      align: 'left',
      lineBreak: false,
    });
    doc
      .font(FONT)
      .fontSize(7.5)
      .text(
        interpolate(COPY.footer.page, { current: index + 1, total: range.count }),
        PAGE_MARGIN,
        footerTop + 6,
        { width: textWidth, align: 'right', lineBreak: false },
      );

    if (qrBuffer) {
      doc.image(qrBuffer, PAGE_WIDTH - PAGE_MARGIN - qrSize, footerTop + 4, {
        fit: [qrSize, qrSize],
      });
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Renders the full BAST document and resolves the finished PDF bytes.
 *
 * Nothing is written to disk: the PDF is always regenerated from the stored
 * form, which stays correct because an ISSUED form is immutable and its
 * party/asset details are frozen snapshots.
 */
export async function renderHandoverFormPdf(data: HandoverPdfData): Promise<Buffer> {
  // Generated before the document is opened so a QR failure can't leave a
  // half-written stream behind.
  let qrBuffer: Buffer | null = null;
  if (data.qrUrl) {
    try {
      qrBuffer = await QRCode.toBuffer(data.qrUrl, { type: 'png', width: 200, margin: 0 });
    } catch {
      qrBuffer = null;
    }
  }

  const logoPath =
    data.company.logoAbsolutePath && fs.existsSync(data.company.logoAbsolutePath)
      ? data.company.logoAbsolutePath
      : null;

  return new Promise<Buffer>((resolve, reject) => {
    // bufferPages keeps every page addressable until `end()`, which is what
    // makes "Page 2 of 5" possible — the total isn't known while the body is
    // still being laid out.
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: PAGE_MARGIN,
        bottom: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
      },
      bufferPages: true,
      info: { Title: `BAST ${data.formNumber}`, Author: data.company.name },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawLetterhead(doc, { ...data.company, logoAbsolutePath: logoPath });
      drawTitle(doc, data.formNumber);

      const { day, date } = formatIndonesianDate(data.handoverDate);
      doc
        .font(FONT)
        .fontSize(10)
        .text(interpolate(COPY.openingParagraph, { day, date }), PAGE_MARGIN, doc.y, {
          width: CONTENT_WIDTH,
          align: 'justify',
        });
      doc.y += 12;

      drawParty(doc, COPY.firstParty, data.firstParty, data.company.name);
      drawParty(doc, COPY.secondParty, data.secondParty, data.company.name);

      if (data.purpose) {
        drawLabelledRow(doc, COPY.fields.purpose, data.purpose);
        doc.y += 10;
      }

      drawAssetTable(doc, data.items);

      if (data.notes) {
        doc.font(FONT_BOLD).fontSize(9.5).text(`${COPY.fields.notes}:`, PAGE_MARGIN, doc.y, {
          width: CONTENT_WIDTH,
        });
        doc.font(FONT).fontSize(9.5).text(data.notes, PAGE_MARGIN, doc.y + 2, {
          width: CONTENT_WIDTH,
          align: 'justify',
        });
        doc.y += 12;
      }

      // The closing statement and the signature grid form one unit: the
      // signatures attest to that specific paragraph, so stranding them on a
      // page by themselves would produce a signature page with no terms on
      // it. Measure both and break before the paragraph if they don't fit.
      const closing = COPY.closingParagraph[data.handoverType];
      doc.font(FONT).fontSize(9.5);
      const closingHeight = doc.heightOfString(closing, {
        width: CONTENT_WIDTH,
        align: 'justify',
      });
      const CLOSING_GAP = 20;
      if (doc.y + closingHeight + CLOSING_GAP + SIGNATURE_GRID_HEIGHT > BODY_BOTTOM) {
        doc.addPage();
      }

      doc.font(FONT).fontSize(9.5).text(closing, PAGE_MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: 'justify',
      });
      doc.y += CLOSING_GAP;

      drawSignatures(doc, data);
      drawFooters(doc, data.formNumber, qrBuffer);

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
