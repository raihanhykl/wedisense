import PDFDocument from 'pdfkit';

const MM_TO_PT = 2.83465;

function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

export interface ReportColumn {
  header: string;
  key: string;
  width: number; // relative weight (1-10)
}

export interface CreateReportPdfOptions {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  metadata?: Record<string, string>;
}

const BRAND_DARK = '#1E3A5F';
const BRAND_ACCENT = '#2E6DA4';
const ROW_ALT = '#F5F7FA';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6B7280';

const PAGE_MARGIN_MM = 10;
const PAGE_MARGIN = mmToPt(PAGE_MARGIN_MM);

// A4 landscape for reports
const PAGE_WIDTH = mmToPt(297);
const PAGE_HEIGHT = mmToPt(210);

const HEADER_H = 50;
const FOOTER_H = 20;
const TABLE_TOP = HEADER_H + 20;
const ROW_H = 18;
const COL_HEADER_H = 22;

export async function createReportPdf(options: CreateReportPdfOptions): Promise<Buffer> {
  const { title, subtitle, columns, rows, metadata } = options;

  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margin: PAGE_MARGIN,
    bufferPages: true,
    autoFirstPage: true,
    layout: 'landscape',
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const usableWidth = PAGE_WIDTH - PAGE_MARGIN * 2;
  const totalWeight = columns.reduce((sum, c) => sum + c.width, 0);
  const colWidths = columns.map((c) => (c.width / totalWeight) * usableWidth);

  function drawHeader(pageTitle: string): void {
    // Background bar
    doc.rect(0, 0, PAGE_WIDTH, HEADER_H).fill(BRAND_DARK);

    // Title
    doc
      .fillColor('#FFFFFF')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(pageTitle, PAGE_MARGIN, 14, { width: usableWidth * 0.65 });

    // Subtitle / metadata
    if (subtitle) {
      doc
        .fillColor('#BFD7F0')
        .font('Helvetica')
        .fontSize(9)
        .text(subtitle, PAGE_MARGIN, 33, { width: usableWidth * 0.65 });
    }

    // Generated at (top-right)
    const generatedAt = `Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })} WIB`;
    doc
      .fillColor('#BFD7F0')
      .font('Helvetica')
      .fontSize(8)
      .text(generatedAt, PAGE_MARGIN + usableWidth * 0.65, 14, {
        width: usableWidth * 0.35,
        align: 'right',
      });

    // Metadata key=value lines
    if (metadata) {
      const metaStr = Object.entries(metadata)
        .map(([k, v]) => `${k}: ${v}`)
        .join('  |  ');
      doc
        .fillColor('#BFD7F0')
        .font('Helvetica')
        .fontSize(8)
        .text(metaStr, PAGE_MARGIN + usableWidth * 0.65, 26, {
          width: usableWidth * 0.35,
          align: 'right',
        });
    }
  }

  function drawColumnHeaders(y: number): void {
    let x = PAGE_MARGIN;
    doc.rect(PAGE_MARGIN, y, usableWidth, COL_HEADER_H).fill(BRAND_ACCENT);

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const cw = colWidths[i]!;
      doc.text(col.header, x + 3, y + 6, { width: cw - 6, ellipsis: true, lineBreak: false });
      x += cw;
    }
  }

  function drawRow(rowData: Record<string, unknown>, y: number, isAlt: boolean): void {
    if (isAlt) {
      doc.rect(PAGE_MARGIN, y, usableWidth, ROW_H).fill(ROW_ALT);
    }

    let x = PAGE_MARGIN;
    doc.font('Helvetica').fontSize(7.5).fillColor(TEXT_DARK);
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]!;
      const cw = colWidths[i]!;
      const val = rowData[col.key];
      let text: string;
      if (val === null || val === undefined) {
        text = '';
      } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        text = String(val);
      } else {
        text = '';
      }
      doc.text(text, x + 3, y + 4, { width: cw - 6, ellipsis: true, lineBreak: false });
      x += cw;
    }

    // Bottom border
    doc
      .moveTo(PAGE_MARGIN, y + ROW_H)
      .lineTo(PAGE_MARGIN + usableWidth, y + ROW_H)
      .strokeColor('#E5E7EB')
      .lineWidth(0.5)
      .stroke();
  }

  function drawFooter(pageNum: number, totalPages: number): void {
    const y = PAGE_HEIGHT - FOOTER_H;
    doc.rect(0, y, PAGE_WIDTH, FOOTER_H).fill(BRAND_DARK);
    doc
      .fillColor('#BFD7F0')
      .font('Helvetica')
      .fontSize(8)
      .text('Wedisense — Asset Management System', PAGE_MARGIN, y + 6, {
        width: usableWidth * 0.6,
      })
      .text(`Page ${pageNum} of ${totalPages}`, PAGE_MARGIN + usableWidth * 0.6, y + 6, {
        width: usableWidth * 0.4,
        align: 'right',
      });
  }

  // ── Render pages ───────────────────────────────────────────────────

  drawHeader(title);
  drawColumnHeaders(TABLE_TOP);

  let yPos = TABLE_TOP + COL_HEADER_H;
  const maxY = PAGE_HEIGHT - FOOTER_H - ROW_H;

  let rowIdx = 0;
  for (const row of rows) {
    if (yPos > maxY) {
      doc.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: PAGE_MARGIN, layout: 'landscape' });
      drawHeader(title);
      drawColumnHeaders(TABLE_TOP);
      yPos = TABLE_TOP + COL_HEADER_H;
    }
    drawRow(row, yPos, rowIdx % 2 === 1);
    yPos += ROW_H;
    rowIdx++;
  }

  // Empty state
  if (rows.length === 0) {
    doc
      .fillColor(TEXT_MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text('No data available for the selected filters.', PAGE_MARGIN, yPos + 10, {
        width: usableWidth,
        align: 'center',
      });
  }

  // Write footers on all pages now that we know total page count
  const totalPages = doc.bufferedPageRange().count;
  for (let p = 0; p < totalPages; p++) {
    doc.switchToPage(p);
    drawFooter(p + 1, totalPages);
  }

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    const finalize = (): void => resolve(Buffer.concat(chunks));
    doc.on('end', finalize);
    doc.on('error', reject);
  });
}
