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
import fontkit from "@pdf-lib/fontkit";
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

const pdfAssetCache = new Map<string, Buffer>();

async function downloadStorageFileCached(path: string) {
  const cached = pdfAssetCache.get(path);

  if (cached) {
    return cached;
  }

  const { data, error } = await supabase.storage
    .from("report-assets")
    .download(path);

  if (error || !data) {
    throw new Error(error?.message || `Could not download ${path}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  pdfAssetCache.set(path, buffer);

  return buffer;
}

function extractPdfCcText(text: string) {
  const match = String(text || "").match(/\[\[PDF_CC:([\s\S]*?)\]\]/);
  return match?.[1]?.trim() || "";
}

function extractPdfDateText(text: string) {
  const match = String(text || "").match(/\[\[PDF_DATE:([\s\S]*?)\]\]/);
  return match?.[1]?.trim() || "";
}

function stripPdfMarkers(text: string) {
  return String(text || "")
    .replace(/\n?\[\[PDF_CC:[\s\S]*?\]\]/g, "")
    .replace(/\n?\[\[PDF_DATE:[\s\S]*?\]\]/g, "")
    .trimEnd();
}

function formatPdfLetterDate(value: string) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return new Date().toLocaleDateString("en-AU");
  }

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return cleanValue;
  }

  return date.toLocaleDateString("en-AU");
}

function formatDob(value: string | null | undefined) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "";

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return cleanValue;
  }

  return date.toLocaleDateString("en-AU");
}

function decodeBasicHtmlEntities(value: string) {
  return String(value || "")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function formatPdfCcLine(value: string) {
  const cleanValue = decodeBasicHtmlEntities(String(value || "")).trim();

  if (!cleanValue) return "";

  const withoutCcPrefix = cleanValue.replace(/^cc\.?\s*/i, "");

  const singleLineDetails = withoutCcPrefix
    .split(/\r?\n|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^cc\.?\s*/i, "").trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^,\s*|,\s*$/g, "");

  return singleLineDetails ? `cc. ${singleLineDetails}` : "";
}

function cleanLetterText(text: string) {
  return stripPdfMarkers(text)
    .replace(/^---$/gm, "")
    .replace(/^Signature:.*$/gim, "")
    .replace(/^Dr .*$/gim, "")
    .replace(/^Specialist .*$/gim, "")
    .trimEnd();
}

type TextRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function parseMarkdownRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let current = "";
  let bold = false;
  let italic = false;
  let underline = false;

  function flush() {
    if (!current) return;
    runs.push({ text: current, bold, italic, underline });
    current = "";
  }

  for (let i = 0; i < text.length; i++) {
    const nextTwo = text.slice(i, i + 2);

    if (nextTwo === "**") {
      flush();
      bold = !bold;
      i++;
      continue;
    }

    if (nextTwo === "__") {
      flush();
      underline = !underline;
      i++;
      continue;
    }

    if (text[i] === "_") {
      flush();
      italic = !italic;
      continue;
    }

    current += text[i];
  }

  flush();
  return runs;
}

function stripMarkdownMarkers(text: string) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/_/g, "");
}


type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

function splitMarkdownTableRow(line: string) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
  );
}

function parseMarkdownTable(lines: string[]): MarkdownTable | null {
  if (lines.length < 2) return null;

  const headers = splitMarkdownTableRow(lines[0]);

  if (headers.length === 0 || !isMarkdownTableSeparator(lines[1])) {
    return null;
  }

  const rows = lines.slice(2).map(splitMarkdownTableRow);
  const columnCount = headers.length;

  return {
    headers,
    rows: rows.map((row) => [
      ...row.slice(0, columnCount),
      ...Array(Math.max(0, columnCount - row.length)).fill(""),
    ]),
  };
}


function preparePdfText(value: string) {
  /*
    pdf-lib + some custom OpenType fonts can render common ligatures
    such as ff/fi/fl with incorrect spacing or text extraction.

    Adding a zero-width non-joiner after the first "f" prevents the font
    from substituting the ligature glyph, while keeping the visible text
    as normal "ff", "fi", or "fl".
  */
  return String(value || "")
    .normalize("NFC")
    .replace(/f(?=f|i|l)/g, "f\u200C")
    .replace(/F(?=F|I|L)/g, "F\u200C");
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

function cleanReferrerTitle(value: unknown) {
  const cleanValue = String(value || "")
    .trim()
    .replace(/\.+$/g, "");

  if (!cleanValue) return "";

  const normalised = cleanValue.toLowerCase();

  const titleMap: Record<string, string> = {
    dr: "Dr",
    doctor: "Dr",
    prof: "Prof",
    professor: "Prof",
    mr: "Mr",
    mister: "Mr",
    ms: "Ms",
    miss: "Miss",
    mrs: "Mrs",
    mx: "Mx",
    assocprof: "Assoc Prof",
    "assoc prof": "Assoc Prof",
    associateprofessor: "Assoc Prof",
    "associate professor": "Assoc Prof",
  };

  return titleMap[normalised] || cleanValue;
}

function getReferrerTitleFromRecord(referrer: any) {
  const raw = referrer?.raw_json || {};

  return cleanReferrerTitle(
    referrer?.title ||
      referrer?.provider_title ||
      referrer?.referrer_title ||
      raw?.title ||
      raw?.provider_title ||
      raw?.providerTitle ||
      raw?.referrer_title ||
      raw?.referrerTitle ||
      raw?.vchTitle ||
      raw?.vchProviderTitle,
  );
}

function stripKnownTitleFromName(value: string) {
  return String(value || "")
    .trim()
    .replace(
      /^(assoc\.?\s*prof\.?|associate\s+professor|professor|prof\.?|doctor|dr\.?|mister|mr\.?|miss|ms\.?|mrs\.?|mx\.?)\s+/i,
      "",
    )
    .trim();
}

function getTitleFromName(value: string) {
  const match = String(value || "")
    .trim()
    .match(/^(assoc\.?\s*prof\.?|associate\s+professor|professor|prof\.?|doctor|dr\.?|mister|mr\.?|miss|ms\.?|mrs\.?|mx\.?)\s+/i);

  return cleanReferrerTitle(match?.[1] || "");
}

function getDearLine(
  referrerName: string | null | undefined,
  _referrerTitle?: string | null,
) {
  const cleanName = decodeBasicHtmlEntities(
    String(referrerName || ""),
  ).trim();

  if (!cleanName) {
    return "Dear Colleague,";
  }

  const withoutTitle = stripKnownTitleFromName(cleanName);
  const firstName = withoutTitle.split(/\s+/).filter(Boolean)[0] || "";

  if (!firstName) {
    return "Dear Colleague,";
  }

  return `Dear ${firstName},`;
}

function normaliseForMatch(value: unknown) {
  return stripKnownTitleFromName(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatReferrerAddressWithPractice(params: {
  practiceName?: string | null;
  address?: string | null;
}) {
  const practiceName = String(params.practiceName || "").trim();
  const address = String(params.address || "").trim();

  if (!practiceName) return address || null;
  if (!address) return practiceName;

  const firstAddressLine = address.split(/\n+/)[0]?.trim().toLowerCase();

  if (firstAddressLine === practiceName.toLowerCase()) {
    return address;
  }

  return [practiceName, address].filter(Boolean).join("\n");
}

function getPossibleReferrerNames(draft: any) {
  const rawJson = draft?.raw_json || {};
  const sourceText = String(
    draft?.source_text ||
      draft?.clinical_notes ||
      draft?.source_clinical_notes ||
      "",
  );

  const appointmentReferrerMatch = sourceText.match(
    /(?:^|\n)\s*Referrer\s*:\s*([^\n\r]+)/i,
  );

  const names = [
    draft?.referrer_name,
    rawJson?.referrer_name,
    rawJson?.referrerName,
    rawJson?.vchReferrer,
    rawJson?.vchReferralProvider,
    rawJson?.vchProvider,
    appointmentReferrerMatch?.[1],
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

function getInlineImageMarker(paragraph: string) {
  const match = String(paragraph || "")
    .trim()
    .match(/^\[\[\s*IMAGE\s*:?\s*(\d+)\s*\]\]$/i);

  if (!match) return null;

  const imageNumber = Number(match[1]);

  if (!Number.isFinite(imageNumber) || imageNumber < 1) {
    return null;
  }

  return imageNumber;
}

async function resolveDraftReferrer(draft: any) {
  const existingName = String(draft?.referrer_name || "").trim();
  const existingAddress = String(draft?.referrer_address || "").trim();

  const { data: linkedQueueRows, error: queueError } = await supabase
    .from("report_letter_queue")
    .select("referrer_name, referrer_address, raw_json")
    .eq("report_draft_id", draft.id)
    .limit(1);

  if (queueError) {
    console.warn("Could not look up linked report_letter_queue row:", queueError);
  }

  const linkedQueue = linkedQueueRows?.[0] || null;
  const queueName = String(linkedQueue?.referrer_name || "").trim();
  const queueAddress = String(linkedQueue?.referrer_address || "").trim();

  const possibleNames = [
    ...getPossibleReferrerNames(draft),
    queueName,
    linkedQueue?.raw_json?.referrer_name,
    linkedQueue?.raw_json?.referrerName,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const fallbackName = existingName || queueName || possibleNames[0] || null;
  const fallbackAddress = existingAddress || queueAddress || null;

  /*
    Important:
    If a referrer address has already been saved on the draft or linked queue row,
    still look up the referrer title, but keep that exact saved address. This
    prevents the duplicate-practice issue when one referrer works at more than
    one practice.
  */
  if (possibleNames.length === 0) {
    return {
      referrerName: fallbackName,
      referrerTitle: getTitleFromName(fallbackName || ""),
      referrerAddress: fallbackAddress,
      source: fallbackName ? "draft_or_queue_name_only" : "empty",
    };
  }

  const { data: referrers, error } = await supabase
    .from("report_referrers")
    .select("name, practice_name, address, raw_json")
    .limit(10000);

  if (error) {
    console.warn("Could not look up report_referrers for PDF fallback:", error);
    return {
      referrerName: fallbackName,
      referrerTitle: getTitleFromName(fallbackName || ""),
      referrerAddress: fallbackAddress,
      source: "lookup_error",
    };
  }

  const candidates = possibleNames.map(normaliseForMatch).filter(Boolean);

  let bestReferrer: any = null;
  let bestScore = 0;

  for (const referrer of referrers || []) {
    const raw = referrer.raw_json || {};
    const fields = [
      referrer.name,
      referrer.practice_name,
      raw.vchProvider,
      raw.vchClinic,
    ]
      .map(normaliseForMatch)
      .filter(Boolean);

    let score = 0;

    for (const candidate of candidates) {
      const candidateWords = new Set(
        candidate.split(" ").filter((word) => word.length > 2),
      );

      for (const field of fields) {
        if (candidate === field) score = Math.max(score, 120);
        if (candidate.includes(field)) score = Math.max(score, 90);
        if (field.includes(candidate)) score = Math.max(score, 80);

        const fieldWords = new Set(
          field.split(" ").filter((word) => word.length > 2),
        );
        const overlap = [...candidateWords].filter((word) =>
          fieldWords.has(word),
        ).length;

        score = Math.max(score, overlap * 20);
      }
    }

    if (score > bestScore) {
      bestReferrer = referrer;
      bestScore = score;
    }
  }

  if (!bestReferrer || bestScore < 40) {
    return {
      referrerName: fallbackName,
      referrerTitle: getTitleFromName(fallbackName || ""),
      referrerAddress: fallbackAddress,
      source: "no_match",
    };
  }

  return {
    referrerName: fallbackName || bestReferrer.name || null,
    referrerTitle:
      getReferrerTitleFromRecord(bestReferrer) ||
      getTitleFromName(fallbackName || bestReferrer.name || ""),
    referrerAddress:
      fallbackAddress ||
      formatReferrerAddressWithPractice({
        practiceName: bestReferrer.practice_name,
        address: bestReferrer.address,
      }),
    source: fallbackAddress
      ? existingAddress
        ? "selected_draft_address_with_referrer_title"
        : "selected_queue_address_with_referrer_title"
      : "report_referrers_fallback",
  };
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

function formatPdfFileDate(value: string) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    const today = new Date();

    return [
      String(today.getDate()).padStart(2, "0"),
      String(today.getMonth() + 1).padStart(2, "0"),
      today.getFullYear(),
    ].join(".");
  }

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return cleanValue.replace(/\//g, ".");
  }

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join(".");
}

function getSafeFilePart(value: string | null | undefined, fallback: string) {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ");
}

function formatReportTypeForFileName(value: string | null | undefined) {
  return String(value || "Report")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
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

  /*
    react-easy-crop calculates crop_area_* against the rotated image canvas.
    Therefore the custom rotation must be applied before the pixel crop.

    This also means the saved crop remains a fixed landscape, portrait or
    square rectangle while only the photograph inside it is rotated.
  */
  let pipeline = sharp(bytes).rotate();

  const cropRotation = Number(image.crop_rotation ?? 0);

  if (cropRotation) {
    pipeline = pipeline.rotate(cropRotation, {
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }

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

    const left = Math.min(
      Math.max(0, Math.round(Number(cropAreaX))),
      Math.max(0, imageWidth - 1),
    );
    const top = Math.min(
      Math.max(0, Math.round(Number(cropAreaY))),
      Math.max(0, imageHeight - 1),
    );
    const width = Math.min(
      imageWidth - left,
      Math.max(1, Math.round(Number(cropAreaWidth))),
    );
    const height = Math.min(
      imageHeight - top,
      Math.max(1, Math.round(Number(cropAreaHeight))),
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

    const resolvedReferrer = await resolveDraftReferrer(draft);
    const pdfReferrerName = resolvedReferrer.referrerName;
    const pdfReferrerTitle = resolvedReferrer.referrerTitle;
    const pdfReferrerAddress = resolvedReferrer.referrerAddress;

    const letterheadBytes = await downloadStorageFileCached(
  "letterhead/focus-letterhead.png",
);

    const signatureBytes = provider.report_signature_path
  ? await downloadStorageFileCached(provider.report_signature_path)
  : null;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    let font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    let boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    let italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    try {
      const bwGradualRegularBytes = await downloadStorageFileCached(
  "fonts/BWGradual-Regular.otf",
);
const bwGradualBoldBytes = await downloadStorageFileCached(
  "fonts/BWGradual-Bold.otf",
);

      font = await pdfDoc.embedFont(bwGradualRegularBytes);
      boldFont = await pdfDoc.embedFont(bwGradualBoldBytes);
      // Keep Helvetica Oblique for italic markdown, because no BW Gradual italic file is loaded here.
    } catch (fontError) {
      console.warn(
        "BW Gradual font unavailable; falling back to Helvetica:",
        fontError,
      );
    }

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

    const topMarginFirstPage = 93;
    const topMarginOtherPages = 120;

    /*
      The letterhead footer artwork extends higher than the visible contact
      details. Keep all flowing body text, images, captions and signatures
      above this protected boundary on every page.

      PDF coordinates start at the bottom of the page, so increasing this
      value moves the usable content boundary upward.
    */
    const bottomLimit = 140;

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

      page.drawText(preparePdfText(text), {
        x: marginLeft,
        y,
        size: options?.size || fontSize,
        font: options?.bold ? boldFont : font,
        color: rgb(0, 0, 0),
      });

      y -= lineHeight;
    }

    function drawParagraph(text: string, options?: { bold?: boolean }) {
      const wrapped = wrapText(stripMarkdownMarkers(text), maxChars);

      for (const line of wrapped) {
        drawLine(line, { bold: options?.bold });
      }
    }

    function getRunFont(run: TextRun) {
      if (run.bold) return boldFont;
      if (run.italic) return italicFont;
      return font;
    }

    function drawUnderline(x: number, baselineY: number, width: number) {
      if (width <= 0) return;

      page.drawLine({
        start: { x, y: baselineY - 2 },
        end: { x: x + width, y: baselineY - 2 },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });
    }


    function wrapPlainTextToWidth(params: {
      text: string;
      maxWidth: number;
      textFont: typeof font;
      size: number;
    }) {
      const words = String(params.text || "").split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let currentLine = "";

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const candidateWidth = params.textFont.widthOfTextAtSize(
          preparePdfText(candidate),
          params.size,
        );

        if (currentLine && candidateWidth > params.maxWidth) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    }

    function drawInlineRuns(runs: TextRun[]) {
      const maxWidth = contentWidth;
      const words: TextRun[] = [];

      for (const run of runs) {
        const pieces = run.text
          .split(/(\s+)/)
          .filter((piece) => piece.length > 0);

        for (const piece of pieces) {
          words.push({
            text: piece,
            bold: run.bold,
            italic: run.italic,
            underline: run.underline,
          });
        }
      }

      let line: TextRun[] = [];
      let lineWidth = 0;

      function measure(run: TextRun) {
        return getRunFont(run).widthOfTextAtSize(
          preparePdfText(run.text),
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
          const runFont = getRunFont(run);
          const pdfText = preparePdfText(run.text);
          const runWidth = runFont.widthOfTextAtSize(pdfText, fontSize);

          page.drawText(pdfText, {
            x,
            y,
            size: fontSize,
            font: runFont,
            color: rgb(0, 0, 0),
          });

          if (run.underline && run.text.trim()) {
            drawUnderline(x, y, runWidth);
          }

          x += runWidth;
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

      drawInlineRuns(parseMarkdownRuns(text));
    }


    function wrapCellText(
      text: string,
      cellWidth: number,
      cellFont = font,
      size = fontSize,
    ) {
      const cleanText = stripMarkdownMarkers(text).trim();

      if (!cleanText) return [""];

      const words = cleanText.split(/\s+/);
      const lines: string[] = [];
      let current = "";

      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        const candidateWidth = cellFont.widthOfTextAtSize(
          preparePdfText(candidate),
          size,
        );

        if (current && candidateWidth > cellWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }

      if (current) lines.push(current);
      return lines.length ? lines : [""];
    }

    function drawMarkdownTable(table: MarkdownTable) {
      const columnCount = table.headers.length;
      if (columnCount === 0) return;

      const borderWidth = 0.6;
      const cellPaddingX = 6;
      const cellPaddingY = 5;
      const tableFontSize = 9;
      const tableLineHeight = 12;
      const columnWidth = contentWidth / columnCount;

      const allRows = [table.headers, ...table.rows];

      function getRowLayout(row: string[], isHeader: boolean) {
        const rowFont = isHeader ? boldFont : font;
        const wrappedCells = row.map((cell) =>
          wrapCellText(
            cell,
            columnWidth - cellPaddingX * 2,
            rowFont,
            tableFontSize,
          ),
        );

        const maximumLines = Math.max(
          1,
          ...wrappedCells.map((lines) => lines.length),
        );

        return {
          wrappedCells,
          height: maximumLines * tableLineHeight + cellPaddingY * 2,
        };
      }

      function drawRow(row: string[], isHeader: boolean) {
        const layout = getRowLayout(row, isHeader);

        if (y - layout.height < bottomLimit) {
          y = newPage();

          if (!isHeader) {
            drawRow(table.headers, true);
          }
        }

        const rowTop = y;
        const rowBottom = y - layout.height;
        const rowFont = isHeader ? boldFont : font;

        if (isHeader) {
          page.drawRectangle({
            x: marginLeft,
            y: rowBottom,
            width: contentWidth,
            height: layout.height,
            color: rgb(0.94, 0.94, 0.94),
          });
        }

        page.drawRectangle({
          x: marginLeft,
          y: rowBottom,
          width: contentWidth,
          height: layout.height,
          borderColor: rgb(0, 0, 0),
          borderWidth,
        });

        for (let columnIndex = 1; columnIndex < columnCount; columnIndex++) {
          const dividerX = marginLeft + columnIndex * columnWidth;

          page.drawLine({
            start: { x: dividerX, y: rowBottom },
            end: { x: dividerX, y: rowTop },
            thickness: borderWidth,
            color: rgb(0, 0, 0),
          });
        }

        layout.wrappedCells.forEach((cellLines, columnIndex) => {
          const textX =
            marginLeft + columnIndex * columnWidth + cellPaddingX;
          let textY = rowTop - cellPaddingY - tableFontSize;

          for (const cellLine of cellLines) {
            page.drawText(preparePdfText(cellLine), {
              x: textX,
              y: textY,
              size: tableFontSize,
              font: rowFont,
              color: rgb(0, 0, 0),
            });

            textY -= tableLineHeight;
          }
        });

        y = rowBottom;
      }

      allRows.forEach((row, index) => {
        drawRow(row, index === 0);
      });

      y -= 10;
    }

    const usedInlineImageIds = new Set<string>();


    function drawEmbeddedImageCover(params: {
      embeddedImage: Awaited<ReturnType<PDFDocument["embedPng"]>>;
      frameX: number;
      frameY: number;
      frameWidth: number;
      frameHeight: number;
    }) {
      const sourceWidth = params.embeddedImage.width;
      const sourceHeight = params.embeddedImage.height;

      if (!sourceWidth || !sourceHeight) {
        return;
      }

      /*
        Scale proportionally until the frame is fully covered. Any excess is
        clipped by the existing frame clipping path, rather than stretching
        the image horizontally or vertically.
      */
      const scale = Math.max(
        params.frameWidth / sourceWidth,
        params.frameHeight / sourceHeight,
      );

      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;

      const drawX =
        params.frameX + (params.frameWidth - drawWidth) / 2;
      const drawY =
        params.frameY + (params.frameHeight - drawHeight) / 2;

      page.drawImage(params.embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
    }


    async function drawImageBlock(image: DraftImage) {
      const embeddedImage = await embedStorageImage(pdfDoc, image);

      const displayWidthPercent = Number(image.display_width_percent ?? 60);

      const imageWidth =
        (contentWidth * Math.min(Math.max(displayWidthPercent, 30), 100)) /
        100;

      // The frame follows the selected crop shape, not the rotated image dimensions.
      // Rotating the photograph therefore never rotates or changes the frame.
      const frameAspectRatio = getImageAspect(image.crop_aspect);
      const frameWidth = imageWidth;
      const frameHeight = frameWidth / frameAspectRatio;

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

      drawEmbeddedImageCover({
        embeddedImage,
        frameX: x,
        frameY,
        frameWidth,
        frameHeight,
      });

      page.pushOperators(popGraphicsState());

      y = frameY - 12;

      if (captionLines.length > 0) {
        for (const captionLine of captionLines) {
          if (y < bottomLimit) {
            y = newPage();
          }

          const captionWidth = boldFont.widthOfTextAtSize(preparePdfText(captionLine), 9);
          const captionX = x + frameWidth / 2 - captionWidth / 2;

          page.drawText(preparePdfText(captionLine), {
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



    async function drawImageWithSideText(
      image: DraftImage,
      sideParagraphs: string[],
    ) {
      const embeddedImage = await embedStorageImage(pdfDoc, image);

      const displayWidthPercent = Number(image.display_width_percent ?? 45);

      // Side-wrapped images work best when they are not too wide.
      // This keeps enough room for a readable text column beside the image.
      const imageWidth =
        (contentWidth * Math.min(Math.max(displayWidthPercent, 30), 55)) /
        100;

      const frameAspectRatio = getImageAspect(image.crop_aspect);
      const frameWidth = imageWidth;
      const frameHeight = frameWidth / frameAspectRatio;

      const gap = 18;
      const paragraphGap = 8;
      const alignment = image.display_alignment === "right" ? "right" : "left";

      const imageX =
        alignment === "right"
          ? marginLeft + contentWidth - frameWidth
          : marginLeft;

      const textX =
        alignment === "right" ? marginLeft : imageX + frameWidth + gap;

      const textWidth = contentWidth - frameWidth - gap;

      const captionLines = image.caption ? wrapText(image.caption, 45) : [];
      const captionHeight =
        captionLines.length > 0 ? captionLines.length * 12 + 18 : 0;

      const totalBlockHeight = frameHeight + captionHeight + 12;

      if (image.display_page_break_before || y - totalBlockHeight < bottomLimit) {
        y = newPage();
      }

      const startY = y;
      const frameY = y - frameHeight;

      page.pushOperators(
        pushGraphicsState(),
        moveTo(imageX, frameY),
        lineTo(imageX + frameWidth, frameY),
        lineTo(imageX + frameWidth, frameY + frameHeight),
        lineTo(imageX, frameY + frameHeight),
        closePath(),
        clip(),
        endPath(),
      );

      drawEmbeddedImageCover({
        embeddedImage,
        frameX: imageX,
        frameY,
        frameWidth,
        frameHeight,
      });

      page.pushOperators(popGraphicsState());

      function wrapRunsToWidth(runs: TextRun[], maxWidth: number) {
        const pieces: TextRun[] = [];

        for (const run of runs) {
          const splitPieces = run.text
            .split(/(\s+)/)
            .filter((piece) => piece.length > 0);

          for (const piece of splitPieces) {
            pieces.push({
              text: piece,
              bold: run.bold,
              italic: run.italic,
              underline: run.underline,
            });
          }
        }

        const lines: TextRun[][] = [];
        let line: TextRun[] = [];
        let lineWidth = 0;

        function measure(run: TextRun) {
          return getRunFont(run).widthOfTextAtSize(
            preparePdfText(run.text),
            fontSize,
          );
        }

        for (const piece of pieces) {
          const width = measure(piece);

          if (line.length > 0 && lineWidth + width > maxWidth) {
            lines.push(line);
            line = [];
            lineWidth = 0;

            if (/^\s+$/.test(piece.text)) continue;
          }

          line.push(piece);
          lineWidth += width;
        }

        if (line.length > 0) {
          lines.push(line);
        }

        return lines;
      }

      function drawRunLine(line: TextRun[], x: number, lineY: number) {
        let currentX = x;

        for (const run of line) {
          const runFont = getRunFont(run);
          const pdfText = preparePdfText(run.text);
          const runWidth = runFont.widthOfTextAtSize(pdfText, fontSize);

          page.drawText(pdfText, {
            x: currentX,
            y: lineY,
            size: fontSize,
            font: runFont,
            color: rgb(0, 0, 0),
          });

          if (run.underline && run.text.trim()) {
            drawUnderline(currentX, lineY, runWidth);
          }

          currentX += runWidth;
        }
      }

      type OverflowParagraph = {
        lines: TextRun[][];
        startsAtLine: number;
      };

      const overflowParagraphs: OverflowParagraph[] = [];
      let textY = startY;
      let sideSpaceExhausted = false;

      for (const paragraph of sideParagraphs) {
        const wrappedLines = wrapRunsToWidth(
          parseMarkdownRuns(paragraph),
          textWidth,
        );

        let firstOverflowLine = wrappedLines.length;

        if (!sideSpaceExhausted) {
          for (let lineIndex = 0; lineIndex < wrappedLines.length; lineIndex++) {
            if (textY < frameY) {
              firstOverflowLine = lineIndex;
              sideSpaceExhausted = true;
              break;
            }

            drawRunLine(wrappedLines[lineIndex], textX, textY);
            textY -= lineHeight;
          }
        } else {
          firstOverflowLine = 0;
        }

        if (firstOverflowLine < wrappedLines.length) {
          overflowParagraphs.push({
            lines: wrappedLines,
            startsAtLine: firstOverflowLine,
          });
        }

        if (!sideSpaceExhausted) {
          // Preserve visible paragraph separation while continuing to use the
          // available column beside the image.
          textY -= paragraphGap;

          if (textY < frameY) {
            sideSpaceExhausted = true;
          }
        }
      }

      y = frameY - 22;

      if (captionLines.length > 0) {
        for (const captionLine of captionLines) {
          if (y < bottomLimit) {
            y = newPage();
          }

          const captionWidth = boldFont.widthOfTextAtSize(
            preparePdfText(captionLine),
            9,
          );
          const captionX = imageX + frameWidth / 2 - captionWidth / 2;

          page.drawText(preparePdfText(captionLine), {
            x: captionX,
            y,
            size: 9,
            font: boldFont,
            color: rgb(0, 0, 0),
          });

          y -= 12;
        }

        y -= 8;
      }

      for (const overflow of overflowParagraphs) {
        const remainingText = overflow.lines
          .slice(overflow.startsAtLine)
          .map((line) => line.map((run) => run.text).join(""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (remainingText) {
          drawRichParagraph(remainingText);
          y -= 8;
        }
      }

      if (overflowParagraphs.length === 0) {
        y -= 8;
      }
    }

    drawLetterhead();

    const rawLetterText = draft.edited_text || draft.ai_generated_text || "";

    const appointmentDate =
      draft.appointment_date ||
      draft.appointment_at ||
      draft.appointment_start ||
      draft.raw_json?.appointment_date ||
      draft.raw_json?.appointmentDate ||
      draft.raw_json?.appointment_at ||
      draft.raw_json?.appointmentStart ||
      draft.raw_json?.appointment_start ||
      extractPdfDateText(rawLetterText);

    const letterDate = formatPdfLetterDate(appointmentDate);
    drawLine(letterDate);

    y -= lineHeight;

    if (pdfReferrerName) {
      drawLine(pdfReferrerName);
    }

    if (pdfReferrerAddress) {
      const addressLines = String(pdfReferrerAddress).split(/\n+/);

      for (const addressLine of addressLines) {
        if (addressLine.trim()) {
          drawLine(addressLine.trim());
        }
      }
    }

    y -= lineHeight * 3;

    drawLine(getDearLine(pdfReferrerName, pdfReferrerTitle));

    y -= lineHeight;

    drawLine(
  `RE: ${draft.patient_name || "Patient"}${
    draft.patient_dob
      ? ` (DOB: ${formatDob(draft.patient_dob)})`
      : ""
  }`,
  { bold: true },
);

    y -= lineHeight;

    const pdfCcLine = formatPdfCcLine(extractPdfCcText(rawLetterText));
    const letterText = cleanLetterText(rawLetterText);

    const paragraphs = letterText.split(/\n/);

    /*
      Includes Warm Regards, signature image, provider name, qualifications,
      and a small safety allowance before any CC line.
    */
    const signatureBlockHeight = 150;

    function estimateRichParagraphHeight(
      text: string,
      options?: { bold?: boolean },
    ) {
      const plainText = stripMarkdownMarkers(text);
      const wrapped = wrapText(plainText, maxChars);

      return Math.max(wrapped.length, 1) * lineHeight +
        (options?.bold ? 4 : 8);
    }

    const lastTextParagraphIndex =
      paragraphs
        .map((paragraph, index) => ({
          paragraph: paragraph.trim(),
          index,
        }))
        .filter(({ paragraph }) => paragraph && !getInlineImageMarker(paragraph))
        .at(-1)?.index ?? -1;

    for (
      let paragraphIndex = 0;
      paragraphIndex < paragraphs.length;
      paragraphIndex++
    ) {
      const rawParagraph = paragraphs[paragraphIndex];
      const cleanParagraph = rawParagraph.trim();

      if (cleanParagraph.startsWith("|")) {
        const tableLines: string[] = [];
        let tableEndIndex = paragraphIndex;

        while (
          tableEndIndex < paragraphs.length &&
          paragraphs[tableEndIndex]?.trim().startsWith("|")
        ) {
          tableLines.push(paragraphs[tableEndIndex].trim());
          tableEndIndex += 1;
        }

        const table = parseMarkdownTable(tableLines);

        if (table) {
          drawMarkdownTable(table);
          paragraphIndex = tableEndIndex - 1;
          continue;
        }
      }

      if (!cleanParagraph) {
        y -= lineHeight;

        if (y < bottomLimit) {
          y = newPage();
        }

        continue;
      }

      const inlineImageNumber = getInlineImageMarker(cleanParagraph);

      if (inlineImageNumber) {
        const image = images[inlineImageNumber - 1];

        if (image) {
          let nextTextParagraphIndex = paragraphIndex + 1;

          while (
            nextTextParagraphIndex < paragraphs.length &&
            !paragraphs[nextTextParagraphIndex]?.trim()
          ) {
            nextTextParagraphIndex += 1;
          }

          const firstNextParagraph =
            paragraphs[nextTextParagraphIndex]?.trim() || "";
          const firstNextParagraphImageNumber =
            getInlineImageMarker(firstNextParagraph);

          const canWrapTextBesideImage =
            firstNextParagraph.length > 0 &&
            !firstNextParagraphImageNumber &&
            ["left", "right"].includes(image.display_alignment || "");

          if (canWrapTextBesideImage) {
            const sideParagraphs: string[] = [];
            let scanIndex = nextTextParagraphIndex;

            /*
              Collect consecutive paragraphs so the text column can continue
              down the full height of the image. Keep the final meaningful
              paragraph outside this block so the existing signature
              keep-together logic can still protect it.
            */
            while (scanIndex < paragraphs.length) {
              const candidate = paragraphs[scanIndex]?.trim() || "";

              if (!candidate) {
                scanIndex += 1;
                continue;
              }

              if (getInlineImageMarker(candidate)) break;
              if (candidate.startsWith("|")) break;
              if (scanIndex === lastTextParagraphIndex) break;

              sideParagraphs.push(candidate);
              scanIndex += 1;
            }

            if (sideParagraphs.length > 0) {
              await drawImageWithSideText(image, sideParagraphs);
              paragraphIndex = scanIndex - 1;
            } else {
              await drawImageBlock(image);
            }
          } else {
            await drawImageBlock(image);
          }

          usedInlineImageIds.add(image.id);
        }

        continue;
      }

      const isHeading =
        cleanParagraph.endsWith(":") && cleanParagraph.length < 60;

      if (paragraphIndex === lastTextParagraphIndex) {
        const finalParagraphHeight = estimateRichParagraphHeight(cleanParagraph, {
          bold: isHeading,
        });

        const remainingSpace = y - bottomLimit;
        const neededSpace = finalParagraphHeight + signatureBlockHeight;

        /*
          Keep the final meaningful paragraph and the entire signature block
          together. If they cannot both fit in the remaining printable area,
          move the final paragraph to a new page before drawing it.

          This deliberately prioritises avoiding an orphaned signature block,
          even when the current page still has some unused space.
        */
        if (remainingSpace < neededSpace) {
          y = newPage();
        }
      }

      drawRichParagraph(cleanParagraph, { bold: isHeading });

      y -= isHeading ? 4 : 8;
    }

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

      const ccLines = wrapPlainTextToWidth({
        text: pdfCcLine,
        maxWidth: contentWidth,
        textFont: italicFont,
        size: fontSize,
      });

      for (const ccLine of ccLines) {
        if (y < bottomLimit) {
          y = newPage();
        }

        page.drawText(preparePdfText(ccLine), {
          x: marginLeft,
          y,
          size: fontSize,
          font: italicFont,
          color: rgb(0, 0, 0),
        });

        y -= lineHeight;
      }
    }

    const unusedImages = images.filter(
      (image) => !usedInlineImageIds.has(image.id),
    );

    if (unusedImages.length > 0) {
      y -= 12;

      drawLine("Clinical Images:", { bold: true });

      y -= 4;

      for (const image of unusedImages) {
        await drawImageBlock(image);
      }
    }

    const pdfBytes = await pdfDoc.save();

    const fileDate = formatPdfFileDate(appointmentDate);

    const patientNameParts = String(draft.patient_name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const patientFirstName = getSafeFilePart(patientNameParts[0], "Patient");
    const patientLastName = getSafeFilePart(
      patientNameParts.slice(1).join(" "),
      "",
    );

    const patientFileName = [patientFirstName, patientLastName]
      .filter(Boolean)
      .join(" ");

    const reportTypeFileName = getSafeFilePart(
      formatReportTypeForFileName(draft.report_type),
      "Letter",
    );

    const fileName = `${fileDate} ${patientFileName} - ${reportTypeFileName}.pdf`;

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
