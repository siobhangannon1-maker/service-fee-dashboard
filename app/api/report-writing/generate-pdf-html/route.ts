import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

const assetCache = new Map<string, Buffer>();

async function downloadStorageFileCached(path: string) {
  const cached = assetCache.get(path);

  if (cached) return cached;

  const { data, error } = await supabase.storage
    .from("report-assets")
    .download(path);

  if (error || !data) {
    throw new Error(error?.message || `Could not download ${path}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  assetCache.set(path, buffer);

  return buffer;
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

function bufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

  if (!cleanValue) return new Date().toLocaleDateString("en-AU");

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) return cleanValue;

  return date.toLocaleDateString("en-AU");
}

function formatDob(value: string | null | undefined) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "";

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) return cleanValue;

  return date.toLocaleDateString("en-AU");
}

function formatPdfCcLine(value: string) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "";
  if (/^cc\.?\s+/i.test(cleanValue)) return cleanValue.replace(/^cc/i, "cc");

  return `cc. ${cleanValue}`;
}

function cleanLetterText(text: string) {
  return stripPdfMarkers(text)
    .replace(/^---$/gm, "")
    .replace(/^Signature:.*$/gim, "")
    .replace(/^Dr .*$/gim, "")
    .replace(/^Specialist .*$/gim, "")
    .trimEnd();
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
  referrerTitle?: string | null,
) {
  const cleanName = String(referrerName || "").trim();
  const title =
    cleanReferrerTitle(referrerTitle) || getTitleFromName(cleanName) || "Dr";

  if (!cleanName) return title ? `Dear ${title},` : "Dear Doctor,";

  const withoutTitle = stripKnownTitleFromName(cleanName);
  const parts = withoutTitle.split(/\s+/).filter(Boolean);
  const lastName = parts[parts.length - 1] || withoutTitle;

  if (!lastName) return title ? `Dear ${title},` : "Dear Doctor,";

  return `Dear ${title} ${lastName},`;
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

  if (firstAddressLine === practiceName.toLowerCase()) return address;

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

  if (!Number.isFinite(imageNumber) || imageNumber < 1) return null;

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

  if (Number.isNaN(date.getTime())) return cleanValue.replace(/\//g, ".");

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

async function imageToDataUrl(image: DraftImage) {
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
    const width = Math.min(imageWidth - left, Math.round(Number(cropAreaWidth)));
    const height = Math.min(
      imageHeight - top,
      Math.round(Number(cropAreaHeight)),
    );

    if (width > 0 && height > 0) {
      pipeline = pipeline.extract({ left, top, width, height });
    }
  }

  const cropRotation = Number(image.crop_rotation ?? 0);

  if (cropRotation) {
    pipeline = pipeline.rotate(cropRotation, {
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    });
  }

  const pngBytes = await pipeline.png({ compressionLevel: 6 }).toBuffer();

  return bufferToDataUrl(pngBytes, "image/png");
}

function markdownToHtml(text: string) {
  let html = escapeHtml(text);

  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([\s\S]+?)__/g, "<u>$1</u>");
  html = html.replace(/_([^_]+?)_/g, "<em>$1</em>");

  return html;
}

function renderAddressLines(value: string | null | undefined) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("\n");
}

async function buildImagesForHtml(images: DraftImage[]) {
  const prepared = [] as Array<DraftImage & { dataUrl: string }>;

  for (const image of images) {
    prepared.push({ ...image, dataUrl: await imageToDataUrl(image) });
  }

  return prepared;
}

function renderImageBlock(image: DraftImage & { dataUrl: string }) {
  const displayWidthPercent = Number(image.display_width_percent ?? 60);
  const widthPercent = Math.min(Math.max(displayWidthPercent, 30), 100);
  const alignment = image.display_alignment || "center";
  const pageBreakClass = image.display_page_break_before ? " page-break-before" : "";

  const alignClass =
    alignment === "left"
      ? "align-left"
      : alignment === "right"
        ? "align-right"
        : "align-center";

  return `
    <figure class="image-block ${alignClass}${pageBreakClass}" style="--image-width: ${widthPercent}%">
      <img src="${image.dataUrl}" />
      ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}
    </figure>
  `;
}

function renderFloatingImage(image: DraftImage & { dataUrl: string }) {
  const displayWidthPercent = Number(image.display_width_percent ?? 45);
  const widthPercent = Math.min(Math.max(displayWidthPercent, 30), 55);
  const alignment = image.display_alignment === "right" ? "right" : "left";
  const pageBreakClass = image.display_page_break_before ? " page-break-before" : "";

  return `
    <figure class="float-image float-image-${alignment}${pageBreakClass}" style="--float-image-width: ${widthPercent}%">
      <img src="${image.dataUrl}" />
      ${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ""}
    </figure>
  `;
}

function renderTextParagraph(cleanParagraph: string) {
  const isHeading = cleanParagraph.endsWith(":") && cleanParagraph.length < 60;

  return isHeading
    ? `<p class="heading-line"><strong>${markdownToHtml(cleanParagraph)}</strong></p>`
    : `<p>${markdownToHtml(cleanParagraph)}</p>`;
}

function renderLetterBody(params: {
  letterText: string;
  images: Array<DraftImage & { dataUrl: string }>;
}) {
  const paragraphs = params.letterText.split(/\n/);
  const usedInlineImageIds = new Set<string>();
  const html: string[] = [];

  const textParagraphIndexes = paragraphs
    .map((paragraph, index) => ({ paragraph: paragraph.trim(), index }))
    .filter(({ paragraph }) => paragraph && !getInlineImageMarker(paragraph))
    .map(({ index }) => index);

  const lastTextParagraphIndex = textParagraphIndexes.at(-1) ?? -1;
  let finalParagraphHtml = "";

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    const cleanParagraph = paragraphs[paragraphIndex].trim();

    if (!cleanParagraph) {
      html.push(`<div class="paragraph-gap"></div>`);
      continue;
    }

    const inlineImageNumber = getInlineImageMarker(cleanParagraph);

    if (inlineImageNumber) {
      const image = params.images[inlineImageNumber - 1];

      if (image) {
        const alignment = image.display_alignment || "center";

        if (["left", "right"].includes(alignment)) {
          // Let Chromium do true text wrapping around the image. The float remains
          // in normal document flow, so following paragraphs wrap beside it until
          // the image naturally finishes.
          html.push(renderFloatingImage(image));
        } else {
          html.push(renderImageBlock(image));
        }

        usedInlineImageIds.add(image.id);
      }

      continue;
    }

    const paragraphHtml = renderTextParagraph(cleanParagraph);

    if (paragraphIndex === lastTextParagraphIndex) {
      finalParagraphHtml = paragraphHtml;
    } else {
      html.push(paragraphHtml);
    }
  }

  const unusedImages = params.images.filter(
    (image) => !usedInlineImageIds.has(image.id),
  );

  const unusedImagesHtml: string[] = [];

  if (unusedImages.length > 0) {
    unusedImagesHtml.push(`<p class="heading-line clinical-images-heading"><strong>Clinical Images:</strong></p>`);

    for (const image of unusedImages) {
      unusedImagesHtml.push(renderImageBlock(image));
    }
  }

  return {
    bodyHtml: html.join("\n"),
    finalParagraphHtml,
    unusedImagesHtml: unusedImagesHtml.join("\n"),
  };
}

function buildHtml(params: {
  letterheadDataUrl: string;
  fontRegularDataUrl: string | null;
  fontBoldDataUrl: string | null;
  signatureDataUrl: string | null;
  letterDate: string;
  referrerName: string | null;
  referrerAddress: string | null;
  dearLine: string;
  patientLine: string;
  bodyHtml: string;
  finalParagraphHtml: string;
  unusedImagesHtml: string;
  providerName: string;
  providerQualifications: string | null;
  pdfCcLine: string;
}) {
  const fontFaces = params.fontRegularDataUrl
    ? `
      @font-face {
        font-family: 'BW Gradual PDF';
        src: url('${params.fontRegularDataUrl}') format('opentype');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      ${
        params.fontBoldDataUrl
          ? `
      @font-face {
        font-family: 'BW Gradual PDF';
        src: url('${params.fontBoldDataUrl}') format('opentype');
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }
      `
          : ""
      }
    `
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    ${fontFaces}

    @page {
      size: A4;
      margin: 155px 72px 105px 72px;
    }

    @page:first {
      margin-top: 93px;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      background: transparent;
      color: #000;
      font-family: ${params.fontRegularDataUrl ? "'BW Gradual PDF', " : ""}Helvetica, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    body {
      /*
        Do not place the letterhead as a CSS background.
        Chromium clips/repositions page backgrounds differently from pdf-lib.
        We render the HTML text first, then compose each page over the exact
        PNG letterhead with pdf-lib after Chromium has finished pagination.
      */
    }

    .content {
      width: 100%;
    }

    p {
      margin: 0 0 8px 0;
      white-space: normal;
      overflow-wrap: break-word;
    }

    .line {
      margin: 0;
      min-height: 14px;
    }

    .spacer-1 {
      height: 14px;
    }

    .spacer-3 {
      height: 42px;
    }

    .paragraph-gap {
      height: 14px;
    }

    .heading-line {
      margin-bottom: 4px;
    }

    .patient-line {
      font-weight: 700;
      margin-bottom: 22px;
    }

    .body {
      margin-top: 0;
    }

    .signature-block {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-top: 18px;
    }

    .signature-image {
      display: block;
      width: 120px;
      height: 38px;
      object-fit: contain;
      object-position: left center;
      margin: 45px 0 26px 0;
    }

    .provider-name {
      font-weight: 700;
      margin: 0;
    }

    .provider-qualifications {
      margin: 0;
    }

    .cc-line {
      font-style: italic;
      margin-top: 12px;
    }

    .image-block {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-top: 20px;
      margin-bottom: 20px;
      width: var(--image-width);
    }

    .image-block img {
      display: block;
      width: 100%;
      height: auto;
      max-width: 100%;
    }

    figcaption {
      font-weight: 700;
      font-size: 9pt;
      text-align: center;
      margin-top: 10px;
    }

    .align-left {
      margin-left: 0;
      margin-right: auto;
    }

    .align-right {
      margin-left: auto;
      margin-right: 0;
    }

    .align-center {
      margin-left: auto;
      margin-right: auto;
    }

    .float-image {
      break-inside: avoid;
      page-break-inside: avoid;
      width: var(--float-image-width);
      margin-top: 0;
      margin-bottom: 12px;
    }

    .float-image-left {
      float: left;
      margin-left: 0;
      margin-right: 18px;
    }

    .float-image-right {
      float: right;
      margin-left: 18px;
      margin-right: 0;
    }

    .float-image img {
      display: block;
      width: 100%;
      height: auto;
      max-width: 100%;
    }

    .final-keep-together {
      clear: both;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .page-break-before {
      break-before: page;
      page-break-before: always;
    }

    .clinical-images-heading {
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <main class="content">
      <div class="line">${escapeHtml(params.letterDate)}</div>
      <div class="spacer-1"></div>

      ${params.referrerName ? `<div class="line">${escapeHtml(params.referrerName)}</div>` : ""}
      ${renderAddressLines(params.referrerAddress)}

      <div class="spacer-3"></div>
      <div class="line">${escapeHtml(params.dearLine)}</div>
      <div class="spacer-1"></div>

      <p class="patient-line">${escapeHtml(params.patientLine)}</p>

      <section class="body">
        ${params.bodyHtml}
      </section>

      <section class="final-keep-together">
        ${params.finalParagraphHtml}
        <section class="signature-block">
          <div class="line">Warm Regards,</div>
        ${
          params.signatureDataUrl
            ? `<img class="signature-image" src="${params.signatureDataUrl}" />`
            : `<div style="height: 109px"></div>`
        }
        <p class="provider-name">${escapeHtml(params.providerName)}</p>
        ${
          params.providerQualifications
            ? `<p class="provider-qualifications">${escapeHtml(params.providerQualifications)}</p>`
            : ""
        }
          ${params.pdfCcLine ? `<p class="cc-line">${escapeHtml(params.pdfCcLine)}</p>` : ""}
        </section>
      </section>

      ${params.unusedImagesHtml}
  </main>
</body>
</html>`;
}

export async function POST(req: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { draftId } = await req.json();

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId" },
        { status: 400 },
      );
    }

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
    const preparedImages = await buildImagesForHtml(images);

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

    const signatureDataUrl = signatureBytes
      ? bufferToDataUrl(
          await sharp(signatureBytes)
            .trim()
            .png({ compressionLevel: 9, adaptiveFiltering: true, force: true })
            .toBuffer(),
          "image/png",
        )
      : null;

    let fontRegularDataUrl: string | null = null;
    let fontBoldDataUrl: string | null = null;

    try {
      const regular = await downloadStorageFileCached("fonts/BWGradual-Regular.otf");
      const bold = await downloadStorageFileCached("fonts/BWGradual-Bold.otf");
      fontRegularDataUrl = bufferToDataUrl(regular, "font/otf");
      fontBoldDataUrl = bufferToDataUrl(bold, "font/otf");
    } catch (fontError) {
      console.warn("BW Gradual font unavailable; falling back to Helvetica:", fontError);
    }

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
    const pdfCcLine = formatPdfCcLine(extractPdfCcText(rawLetterText));
    const letterText = cleanLetterText(rawLetterText);

    const patientLine = `RE: ${draft.patient_name || "Patient"}${
      draft.patient_dob ? ` (DOB: ${formatDob(draft.patient_dob)})` : ""
    }`;

    const renderedLetterBody = renderLetterBody({
      letterText,
      images: preparedImages,
    });

    const html = buildHtml({
      letterheadDataUrl: bufferToDataUrl(letterheadBytes, "image/png"),
      fontRegularDataUrl,
      fontBoldDataUrl,
      signatureDataUrl,
      letterDate,
      referrerName: pdfReferrerName,
      referrerAddress: pdfReferrerAddress,
      dearLine: getDearLine(pdfReferrerName, pdfReferrerTitle),
      patientLine,
      bodyHtml: renderedLetterBody.bodyHtml,
      finalParagraphHtml: renderedLetterBody.finalParagraphHtml,
      unusedImagesHtml: renderedLetterBody.unusedImagesHtml,
      providerName: provider.report_display_name || provider.name,
      providerQualifications: provider.report_qualifications,
      pdfCcLine,
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });

    await page.setContent(html, { waitUntil: "networkidle" });

    const htmlPdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
          left: "0mm",
        },
      }),
    );

    /*
      Important:
      Playwright/Chromium is excellent at text shaping and pagination, but it
      can crop or reposition a full-page CSS background when @page margins are
      involved. To keep the letterhead identical to the old pdf-lib route, we
      now use Chromium only for the letter content, then create a fresh PDF
      where each page is:
        1. exact full-page letterhead PNG
        2. the rendered Chromium page on top
    */
    const htmlPdfDoc = await PDFDocument.load(htmlPdfBuffer);
    const finalPdfDoc = await PDFDocument.create();
    const letterheadImage = await finalPdfDoc.embedPng(letterheadBytes);
    const embeddedHtmlPages = await finalPdfDoc.embedPages(htmlPdfDoc.getPages());

    const pageWidth = 595.28;
    const pageHeight = 841.89;

    for (const embeddedHtmlPage of embeddedHtmlPages) {
      const finalPage = finalPdfDoc.addPage([pageWidth, pageHeight]);

      finalPage.drawImage(letterheadImage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });

      finalPage.drawPage(embeddedHtmlPage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }

    const pdfBuffer = Buffer.from(await finalPdfDoc.save());

    await browser.close();
    browser = null;

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

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }

    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate PDF",
      },
      { status: 500 },
    );
  }
}
