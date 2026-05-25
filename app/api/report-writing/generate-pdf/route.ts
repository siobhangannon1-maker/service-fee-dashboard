import {
  PDFDocument,
  rgb,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
} from "pdf-lib";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type DraftImage = {
  id: string;
  storage_path: string;
  original_filename: string | null;
  caption: string | null;
  crop_x: number | null;
  crop_y: number | null;
  crop_zoom: number | null;
  crop_rotation: number | null;
  crop_aspect: string | null;
  crop_area_x: number | null;
  crop_area_y: number | null;
  crop_area_width: number | null;
  crop_area_height: number | null;
  display_width_percent: number | null;
  display_alignment: string | null;
  display_page_break_before: boolean | null;
};

function extractPdfCcText(text: string) {
  const match = String(text || "").match(/\n?\[\[PDF_CC:([\s\S]*?)\]\]\s*$/);
  return match?.[1]?.trim() || "";
}

function stripPdfCcMarker(text: string) {
  return String(text || "")
    .replace(/\n?\[\[PDF_CC:[\s\S]*?\]\]\s*$/, "")
    .trimEnd();
}

function formatPdfCcLine(value: string) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "";
  if (/^cc\.?\s+/i.test(cleanValue)) return cleanValue.replace(/^cc/i, "cc");

  return `cc. ${cleanValue}`;
}

function cleanLetterText(text: string) {
  return stripPdfCcMarker(text)
    .replace(/^---$/gm, "")
    .replace(/^Signature:.*$/gim, "")
    .replace(/^Dr .*$/gim, "")
    .replace(/^Specialist .*$/gim, "")
    .trim();
}

type TextRun = {
  text: string;
  bold: boolean;
};

function parseBoldMarkdown(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const parts = String(text || "").split(/(\*\*)/);
  let bold = false;

  for (const part of parts) {
    if (part === "**") {
      bold = !bold;
      continue;
    }

    if (part) {
      runs.push({ text: part, bold });
    }
  }

  return runs;
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars) {
      lines.push(line.trim());
      line = word;
    } else {
      line += " " + word;
    }
  }

  if (line.trim()) lines.push(line.trim());
  return lines;
}

function getDearLine(referrerName: string | null | undefined) {
  const cleanName = String(referrerName || "").trim();

  if (!cleanName) return "Dear Doctor,";

  const withoutTitle = cleanName
    .replace(/^Dr\s+/i, "")
    .replace(/^Doctor\s+/i, "")
    .replace(/^Prof\s+/i, "")
    .replace(/^Professor\s+/i, "")
    .trim();

  const parts = withoutTitle.split(/\s+/).filter(Boolean);
  const lastName = parts[parts.length - 1] || withoutTitle;

  return `Dear Dr ${lastName},`;
}

function getImageAspect(aspect: string | null | undefined) {
  if (aspect === "square") return 1;
  if (aspect === "portrait") return 3 / 4;
  if (aspect === "landscape") return 16 / 9;
  return 16 / 9;
}

function getAlignedX(params: {
  alignment: string | null | undefined;
  marginLeft: number;
  contentWidth: number;
  imageWidth: number;
}) {
  if (params.alignment === "left") return params.marginLeft;

  if (params.alignment === "right") {
    return params.marginLeft + params.contentWidth - params.imageWidth;
  }

  return params.marginLeft + (params.contentWidth - params.imageWidth) / 2;
}

function getSafePatientName(patientName: string | null | undefined) {
  return patientName
    ? String(patientName)
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
    : "Patient";
}

function getFileDate() {
  return new Date().toISOString().slice(0, 10);
}

async function downloadStorageFile(path: string) {
  const { data, error } = await supabase.storage
    .from("report-assets")
    .download(path);

  if (error || !data) {
    throw new Error(error?.message || `Could not download ${path}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

async function embedStorageImage(pdfDoc: PDFDocument, image: DraftImage) {
  const bytes = await downloadStorageFile(image.storage_path);

  let pipeline = sharp(bytes).rotate();

  const cropAreaX = image.crop_area_x;
  const cropAreaY = image.crop_area_y;
  const cropAreaWidth = image.crop_area_width;
  const cropAreaHeight = image.crop_area_height;

  if (
    cropAreaX !== null &&
    cropAreaY !== null &&
    cropAreaWidth !== null &&
    cropAreaHeight !== null &&
    Number(cropAreaWidth) > 0 &&
    Number(cropAreaHeight) > 0
  ) {
    const metadata = await pipeline.metadata();
    const imageWidth = metadata.width || 0;
    const imageHeight = metadata.height || 0;

    const left = Math.max(0, Math.round(Number(cropAreaX)));
    const top = Math.max(0, Math.round(Number(cropAreaY)));
    const width = Math.min(
      imageWidth - left,
      Math.round(Number(cropAreaWidth)),
    );
    const height = Math.min(
      imageHeight - top,
      Math.round(Number(cropAreaHeight)),
    );

    if (width > 0 && height > 0) {
      pipeline = pipeline.extract({
        left,
        top,
        width,
        height,
      });
    }
  }

  const cropRotation = Number(image.crop_rotation ?? 0);

  if (cropRotation) {
    pipeline = pipeline.rotate(cropRotation, {
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }

  const pngBytes = await pipeline
    .png({
      compressionLevel: 0,
    })
    .toBuffer();

  return pdfDoc.embedPng(pngBytes);
}

export async function POST(req: Request) {
  try {
    const { draftId } = await req.json();

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found" },
        { status: 404 },
      );
    }

    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select(
        "id, name, report_display_name, report_qualifications, report_signature_path",
      )
      .eq("id", draft.provider_id)
      .single();

    if (providerError || !provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 },
      );
    }

    const { data: imageRows, error: imageError } = await supabase
      .from("report_draft_images")
      .select("*")
      .eq("report_draft_id", draft.id)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (imageError) {
      return NextResponse.json(
        { success: false, error: imageError.message },
        { status: 500 },
      );
    }

    const images = (imageRows || []) as DraftImage[];

    const letterheadBytes = await downloadStorageFile(
      "letterhead/focus-letterhead.png",
    );

    const signatureBytes = provider.report_signature_path
      ? await downloadStorageFile(provider.report_signature_path)
      : null;

    const pdfDoc = await PDFDocument.create();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const letterheadImage = await pdfDoc.embedPng(letterheadBytes);

    const signatureImage = signatureBytes
      ? await pdfDoc.embedPng(
          await sharp(signatureBytes)
            .trim()
            .png({
              compressionLevel: 9,
              adaptiveFiltering: true,
              force: true,
            })
            .toBuffer(),
        )
      : null;

    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const marginLeft = 72;
    const marginRight = 72;
    const contentWidth = pageWidth - marginLeft - marginRight;

    const topMarginFirstPage = 135;
    const topMarginOtherPages = 120;
    const bottomLimit = 145;

    const fontSize = 10;
    const lineHeight = 14;
    const maxChars = 82;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - topMarginFirstPage;

    function drawLetterhead() {
      page.drawImage(letterheadImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }

    function newPage() {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      drawLetterhead();
      return pageHeight - topMarginOtherPages;
    }

    function drawLine(
      text: string,
      options?: {
        bold?: boolean;
        size?: number;
      },
    ) {
      if (y < bottomLimit) {
        y = newPage();
      }

      page.drawText(text, {
        x: marginLeft,
        y,
        size: options?.size || fontSize,
        font: options?.bold ? boldFont : font,
        color: rgb(0, 0, 0),
      });

      y -= lineHeight;
    }

    function drawParagraph(text: string, options?: { bold?: boolean }) {
      const wrapped = wrapText(text.replace(/\*\*/g, ""), maxChars);

      for (const line of wrapped) {
        drawLine(line, { bold: options?.bold });
      }
    }

    function drawInlineRuns(runs: TextRun[]) {
      const maxWidth = contentWidth;
      const words: TextRun[] = [];

      for (const run of runs) {
        const pieces = run.text
          .split(/(\s+)/)
          .filter((piece) => piece.length > 0);
        for (const piece of pieces) {
          words.push({ text: piece, bold: run.bold });
        }
      }

      let line: TextRun[] = [];
      let lineWidth = 0;

      function measure(run: TextRun) {
        return (run.bold ? boldFont : font).widthOfTextAtSize(
          run.text,
          fontSize,
        );
      }

      function flushLine() {
        if (line.length === 0) return;

        if (y < bottomLimit) {
          y = newPage();
        }

        let x = marginLeft;

        for (const run of line) {
          page.drawText(run.text, {
            x,
            y,
            size: fontSize,
            font: run.bold ? boldFont : font,
            color: rgb(0, 0, 0),
          });

          x += measure(run);
        }

        y -= lineHeight;
        line = [];
        lineWidth = 0;
      }

      for (const word of words) {
        const width = measure(word);

        if (line.length > 0 && lineWidth + width > maxWidth) {
          flushLine();

          if (/^\s+$/.test(word.text)) continue;
        }

        line.push(word);
        lineWidth += width;
      }

      flushLine();
    }

    function drawRichParagraph(text: string, options?: { bold?: boolean }) {
      if (options?.bold) {
        drawParagraph(text, { bold: true });
        return;
      }

      drawInlineRuns(parseBoldMarkdown(text));
    }

    drawLetterhead();

    const today = new Date().toLocaleDateString("en-AU");
    drawLine(today);

    y -= lineHeight;

    if (draft.referrer_name) {
      drawLine(draft.referrer_name);
    }

    if (draft.referrer_address) {
      const addressLines = String(draft.referrer_address).split(/\n+/);

      for (const addressLine of addressLines) {
        if (addressLine.trim()) {
          drawLine(addressLine.trim());
        }
      }
    }

    y -= lineHeight;

    drawLine(getDearLine(draft.referrer_name));

    y -= lineHeight;

    drawLine(
      `RE: ${draft.patient_name || "Patient"}${
        draft.patient_dob ? ` (DOB: ${draft.patient_dob})` : ""
      }`,
      { bold: true },
    );

    y -= lineHeight;

    const rawLetterText = draft.edited_text || draft.ai_generated_text || "";
    const pdfCcLine = formatPdfCcLine(extractPdfCcText(rawLetterText));
    const letterText = cleanLetterText(rawLetterText);

    const paragraphs = letterText.split(/\n+/);

    for (const paragraph of paragraphs) {
      const cleanParagraph = paragraph.trim();

      if (!cleanParagraph) continue;

      const isHeading =
        cleanParagraph.endsWith(":") && cleanParagraph.length < 60;

      drawRichParagraph(cleanParagraph, { bold: isHeading });

      y -= isHeading ? 4 : 8;
    }

    const signatureBlockHeight = 130;

    if (y < bottomLimit + signatureBlockHeight) {
      y = newPage();
    }

    y -= 10;

    drawLine("Warm Regards,");

    y -= 45;

    if (signatureImage) {
      const signatureWidth = 120;
      const signatureHeight = 38;

      page.drawImage(signatureImage, {
        x: marginLeft,
        y,
        width: signatureWidth,
        height: signatureHeight,
      });
    }

    y -= 26;

    drawLine(provider.report_display_name || provider.name, {
      bold: true,
    });

    if (provider.report_qualifications) {
      drawLine(provider.report_qualifications);
    }

    if (pdfCcLine) {
      y -= 6;

      if (y < bottomLimit) {
        y = newPage();
      }

      page.drawText(pdfCcLine, {
        x: marginLeft,
        y,
        size: fontSize,
        font: italicFont,
        color: rgb(0, 0, 0),
      });

      y -= lineHeight;
    }

    if (images.length > 0) {
      y -= 12;

      drawLine("Clinical Images:", { bold: true });

      y -= 4;

      for (const image of images) {
        const embeddedImage = await embedStorageImage(pdfDoc, image);

        const displayWidthPercent = Number(image.display_width_percent ?? 60);

        const imageWidth =
          (contentWidth * Math.min(Math.max(displayWidthPercent, 30), 100)) /
          100;

        const embeddedDims = embeddedImage.scale(1);
        const actualAspectRatio = embeddedDims.width / embeddedDims.height;

        const frameWidth = imageWidth;
        const frameHeight = frameWidth / actualAspectRatio;

        const captionLines = image.caption ? wrapText(image.caption, 75) : [];

        const captionHeight =
          captionLines.length > 0 ? captionLines.length * 12 + 10 : 0;

        const totalImageBlockHeight = frameHeight + captionHeight + 28;

        if (
          image.display_page_break_before ||
          y - totalImageBlockHeight < bottomLimit
        ) {
          y = newPage();
        }

        const x = getAlignedX({
          alignment: image.display_alignment,
          marginLeft,
          contentWidth,
          imageWidth: frameWidth,
        });

        const frameY = y - frameHeight;

        page.pushOperators(
          pushGraphicsState(),
          moveTo(x, frameY),
          lineTo(x + frameWidth, frameY),
          lineTo(x + frameWidth, frameY + frameHeight),
          lineTo(x, frameY + frameHeight),
          closePath(),
          clip(),
          endPath(),
        );

        page.drawImage(embeddedImage, {
          x,
          y: frameY,
          width: frameWidth,
          height: frameHeight,
        });

        page.pushOperators(popGraphicsState());

        y = frameY - 12;

        if (captionLines.length > 0) {
          for (const captionLine of captionLines) {
            if (y < bottomLimit) {
              y = newPage();
            }

            const captionWidth = boldFont.widthOfTextAtSize(captionLine, 9);
            const captionX = x + frameWidth / 2 - captionWidth / 2;

            page.drawText(captionLine, {
              x: captionX,
              y,
              size: 9,
              font: boldFont,
              color: rgb(0, 0, 0),
            });

            y -= 12;
          }

          y -= 8;
        } else {
          y -= 8;
        }
      }
    }

    const pdfBytes = await pdfDoc.save();

    const safePatientName = getSafePatientName(draft.patient_name);
    const fileDate = getFileDate();
    const fileName = `${fileDate} ${safePatientName} Letter.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to generate PDF",
      },
      { status: 500 },
    );
  }
}
