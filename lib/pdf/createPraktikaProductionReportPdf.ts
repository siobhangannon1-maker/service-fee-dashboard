import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ProductionReportLine } from "@/lib/praktika/fetchCompletedProceduresReport";

function money(value: number) {
  return Number(value || 0).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function clean(value: string | null | undefined) {
  return String(value || "")
    .replace(/[\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAustralianDate(value: string | null | undefined) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-AU");
}

export async function createPraktikaProductionReportPdf(input: {
  providerName: string;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  rows: ProductionReportLine[];
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 32;
  let y = pageHeight - 40;

  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    y = pageHeight - 40;
  }

  function ensureSpace(height: number) {
    if (y - height < 40) newPage();
  }

  function text(
    value: string,
    x: number,
    yPos: number,
    options?: { size?: number; bold?: boolean; maxWidth?: number }
  ) {
    const size = options?.size || 7.5;
    const font = options?.bold ? bold : regular;
    const valueClean = clean(value);

    if (!options?.maxWidth) {
      page.drawText(valueClean, {
        x,
        y: yPos,
        size,
        font,
        color: rgb(0.05, 0.09, 0.16),
      });
      return;
    }

    let line = "";
    let currentY = yPos;

    for (const word of valueClean.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > options.maxWidth && line) {
        page.drawText(line, { x, y: currentY, size, font });
        currentY -= size + 2;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) page.drawText(line, { x, y: currentY, size, font });
  }

  function amount(value: number, yPos: number) {
    const display = money(value);
    const width = regular.widthOfTextAtSize(display, 7.5);
    page.drawText(display, {
      x: pageWidth - margin - width,
      y: yPos,
      size: 7.5,
      font: regular,
    });
  }

  text("PRAKTIKA PRODUCTION REPORT", margin, y, { size: 16, bold: true });
  y -= 22;
  text(input.providerName, margin, y, { size: 11, bold: true });
  y -= 15;
  text(`${input.periodLabel} | ${input.fromDate} to ${input.toDate}`, margin, y, {
    size: 9,
  });
  y -= 24;

  page.drawRectangle({
    x: margin,
    y: y - 6,
    width: pageWidth - margin * 2,
    height: 18,
    color: rgb(0.93, 0.96, 1),
  });

  text("Date", margin + 3, y, { bold: true });
text("Patient", margin + 85, y, { bold: true });
text("No.", margin + 275, y, { bold: true });
text("Item", margin + 340, y, { bold: true });
text("Amount", pageWidth - margin - 50, y, { bold: true });

  y -= 20;

  let total = 0;

  for (const row of input.rows) {
    ensureSpace(18);

    total += row.amount;

    text(formatAustralianDate(row.completedDate), margin + 3, y, {
  maxWidth: 75,
});

text(row.patientName, margin + 85, y, {
  maxWidth: 180,
});

text(row.patientNumber, margin + 275, y, {
  maxWidth: 55,
});

text(row.itemCode, margin + 340, y, {
  maxWidth: 50,
});

amount(row.amount, y);

    y -= 15;
  }

  y -= 8;

  page.drawLine({
    start: { x: margin, y: y + 7 },
    end: { x: pageWidth - margin, y: y + 7 },
    thickness: 0.8,
    color: rgb(0.15, 0.23, 0.35),
  });

  text("Total production", margin, y, { size: 10, bold: true });

  const totalText = money(total);
  const totalWidth = bold.widthOfTextAtSize(totalText, 10);
  page.drawText(totalText, {
    x: pageWidth - margin - totalWidth,
    y,
    size: 10,
    font: bold,
  });

  return Buffer.from(await pdf.save());
}
