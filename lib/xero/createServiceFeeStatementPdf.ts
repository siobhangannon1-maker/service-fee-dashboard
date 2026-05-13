import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type DetailLine = {
  patient_name?: string | null;
  notes?: string | null;
  amount: number;
};

type ServiceFeeBreakdownLine = {
  label: string;
  amount: number;
};

export type ServiceFeeStatementPdfInput = {
  providerName: string;
  providerAbn?: string | null;
  periodLabel: string;
  logoDataUrl?: string | null;

  grossProduction: number;
  adjustments: number;
  labMaterialsExGst: number;
  hummFeesExGst: number;
  afterpayFeesExGst: number;
  ivFacilityFeesNoGst: number;
  otherDeductions: number;
  feeBase: number;

  serviceFeeBreakdownLines: ServiceFeeBreakdownLine[];
  serviceFeeExGst: number;
  serviceFeeGst: number;
  serviceFeeIncGst: number;

  labMaterialsGst: number;
  hummFeesGst: number;
  afterpayFeesGst: number;
  totalGst: number;
  feesAndCostsTotalIncGst: number;

  patientFeesPaidToFocusNoGst: number;
  patientFeesReceivedInErrorNoGst: number;
  patientFeesPaidToAnotherProviderNoGst: number;
  finalTotalDue: number;

  implantEntries: DetailLine[];
  hummEntries: DetailLine[];
  afterpayEntries: DetailLine[];
  paidToFocusEntries: DetailLine[];
  paidToThisProviderInErrorEntries: DetailLine[];
  paidToAnotherProviderEntries: DetailLine[];
};

const PRACTICE = {
  name: "Focus Dental Specialists Pty Ltd",
  address: "7/377 Cavendish Road COORPAROO QLD 4151",
  phone: "07 3077 9620",
  email: "hello@focusoms.com.au",
  abn: "44 642 634 982",
};

function money(value: number) {
  return Number(value || 0).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function stripDataUrl(dataUrl: string) {
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : dataUrl;
}

function sanitizeText(value: string) {
  return String(value || "")
    .replace(/[\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createServiceFeeStatementPdf(
  input: ServiceFeeStatementPdfInput
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]);
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 40;
  let y = pageHeight - 40;

  function newPage() {
    page = pdf.addPage([595.28, 841.89]);
    y = pageHeight - 40;
  }

  function ensureSpace(height: number) {
    if (y - height < 45) {
      newPage();
    }
  }

  function drawText(
    text: string,
    x: number,
    yPos: number,
    options?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; maxWidth?: number }
  ) {
    const size = options?.size || 9;
    const font = options?.bold ? boldFont : regularFont;
    const clean = sanitizeText(text);
    const maxWidth = options?.maxWidth;

    if (!maxWidth) {
      page.drawText(clean, {
        x,
        y: yPos,
        size,
        font,
        color: options?.color || rgb(0.05, 0.09, 0.16),
      });
      return;
    }

    const words = clean.split(" ");
    let line = "";
    let currentY = yPos;

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(candidate, size);
      if (width > maxWidth && line) {
        page.drawText(line, {
          x,
          y: currentY,
          size,
          font,
          color: options?.color || rgb(0.05, 0.09, 0.16),
        });
        currentY -= size + 3;
        line = word;
      } else {
        line = candidate;
      }
    }

    if (line) {
      page.drawText(line, {
        x,
        y: currentY,
        size,
        font,
        color: options?.color || rgb(0.05, 0.09, 0.16),
      });
    }
  }

  function drawAmount(value: number, yPos: number, bold = false) {
    const text = money(value);
    const font = bold ? boldFont : regularFont;
    const size = bold ? 10 : 9;
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: pageWidth - margin - width,
      y: yPos,
      size,
      font,
      color: rgb(0.05, 0.09, 0.16),
    });
  }

  async function drawHeader() {
    if (input.logoDataUrl) {
      try {
        const logoBytes = Buffer.from(stripDataUrl(input.logoDataUrl), "base64");
        const logo = input.logoDataUrl.includes("image/jpeg")
          ? await pdf.embedJpg(logoBytes)
          : await pdf.embedPng(logoBytes);

        const logoWidth = 160;
        const logoHeight = (logo.height / logo.width) * logoWidth;
        page.drawImage(logo, {
          x: margin,
          y: y - logoHeight,
          width: logoWidth,
          height: logoHeight,
        });
      } catch {
        drawText(PRACTICE.name, margin, y - 20, { size: 14, bold: true });
      }
    } else {
      drawText(PRACTICE.name, margin, y - 20, { size: 14, bold: true });
    }

    drawText("STATEMENT", 400, y - 8, {
      size: 18,
      bold: true,
      color: rgb(0.74, 0.08, 0.42),
    });
    drawText(input.periodLabel, 400, y - 28, { size: 11, bold: true });

    y -= 95;

    drawText(input.providerName, margin, y, { size: 13, bold: true });
    y -= 15;
    if (input.providerAbn) {
      drawText(`ABN: ${input.providerAbn}`, margin, y, { size: 9 });
      y -= 13;
    }

    drawText(PRACTICE.name, margin, y, { size: 9, bold: true });
    y -= 12;
    drawText(PRACTICE.address, margin, y, { size: 9 });
    y -= 12;
    drawText(`Ph: ${PRACTICE.phone}`, margin, y, { size: 9 });
    y -= 12;
    drawText(`Email: ${PRACTICE.email}`, margin, y, { size: 9 });
    y -= 12;
    drawText(`ABN ${PRACTICE.abn}`, margin, y, { size: 9 });
    y -= 25;
  }

  function sectionTitle(title: string) {
    ensureSpace(25);
    page.drawRectangle({
      x: margin,
      y: y - 6,
      width: pageWidth - margin * 2,
      height: 18,
      color: rgb(0.93, 0.96, 1),
    });
    drawText(title, margin + 6, y, { size: 10, bold: true });
    y -= 24;
  }

  function row(label: string, amount?: number, options?: { bold?: boolean; indent?: number }) {
    ensureSpace(18);
    drawText(label, margin + (options?.indent || 0), y, {
      size: options?.bold ? 10 : 9,
      bold: options?.bold,
      maxWidth: 360,
    });
    if (amount !== undefined) {
      drawAmount(amount, y, options?.bold);
    }
    y -= options?.bold ? 18 : 15;
  }

  function detailSection(title: string, items: DetailLine[], total: number) {
    sectionTitle(title);

    if (items.length === 0) {
      row("Nil", 0);
      y -= 6;
      return;
    }

    for (const item of items) {
      const label = `${item.patient_name || ""}${item.notes ? ` ${item.notes}` : ""}`.trim();
      row(label || "Item", Number(item.amount || 0));
    }

    page.drawLine({
      start: { x: margin, y: y + 7 },
      end: { x: pageWidth - margin, y: y + 7 },
      thickness: 0.6,
      color: rgb(0.15, 0.23, 0.35),
    });
    row("Total", total, { bold: true });
    y -= 8;
  }

  await drawHeader();

  sectionTitle("Activity Payments");
  for (const line of input.serviceFeeBreakdownLines || []) {
    row(line.label, line.amount);
  }
  row("Service fee", input.serviceFeeExGst, { bold: true });
  row("Plus GST", input.serviceFeeGst);
  row("Service fee due", input.serviceFeeIncGst, { bold: true });

  sectionTitle("Add");
  row("Lab/materials expenses", input.labMaterialsExGst);
  row("Humm merchant fees", input.hummFeesExGst);
  row("Afterpay fees", input.afterpayFeesExGst);
  row("Plus GST", input.labMaterialsGst + input.hummFeesGst + input.afterpayFeesGst);
  row("Total fees and costs", input.feesAndCostsTotalIncGst, { bold: true });
  row("Includes GST", input.totalGst, { bold: true });

  sectionTitle("Adjustments for patient fees - no GST included");
  row(`Less patient fees owed to ${input.providerName}`, input.patientFeesPaidToFocusNoGst);
  row(`Facility fees paid to ${input.providerName}, owed to Focus`, input.patientFeesPaidToAnotherProviderNoGst);
  row(`Patient fee paid to ${input.providerName} in error`, input.patientFeesReceivedInErrorNoGst);
  row("Plus IV Facility Fees", input.ivFacilityFeesNoGst);
  row("TOTAL DUE TO FOCUS DENTAL", input.finalTotalDue, { bold: true });

  sectionTitle("Patient Billings");
  row("Gross production", input.grossProduction);
  row("Patient billings adjustment", input.adjustments);
  row("Less implants/materials expenses", -input.labMaterialsExGst);
  row("Less Humm fees", -input.hummFeesExGst);
  row("Less Afterpay fees", -input.afterpayFeesExGst);
  row("Less IV Facility Fees", -input.ivFacilityFeesNoGst);
  row("Less other deductions", -input.otherDeductions);
  row("NET PATIENT FEES", input.feeBase, { bold: true });

  detailSection("Implant/Grafting Materials/Guides NET excluding GST", input.implantEntries, input.labMaterialsExGst);
  detailSection("Humm Merchant Fees NET excluding GST", input.hummEntries, input.hummFeesExGst);
  detailSection("Afterpay Fees NET excluding GST", input.afterpayEntries, input.afterpayFeesExGst);
  detailSection("Patient fees owed to provider", input.paidToFocusEntries, input.patientFeesPaidToFocusNoGst);
  detailSection(`Patient fee paid to ${input.providerName} in error`, input.paidToThisProviderInErrorEntries, input.patientFeesReceivedInErrorNoGst);
  detailSection("Facility fees paid to another provider, owed to Focus", input.paidToAnotherProviderEntries, input.patientFeesPaidToAnotherProviderNoGst);

  const pdfBytes = await pdf.save();
  return Buffer.from(pdfBytes);
}
