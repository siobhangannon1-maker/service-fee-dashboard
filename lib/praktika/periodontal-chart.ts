import { drawPraktikaToothWithClinicalMarkers } from "@/lib/praktika/praktika-perio-tooth-renderer"
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFPage,
  PDFFont,
} from "pdf-lib"
import {
  requestPraktikaJson,
  PRAKTIKA_APP_BASE_URL,
} from "@/lib/praktika/praktika-request"
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request"
import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store"

const PRAKTIKA_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || "1181")

const DRAW_TEETH = true

type PerioToothData = Record<string, any>

type PerioExam = {
  perioexam_id: number
  perioexam_patientid: number
  perioexam_providerid: number | null
  perioexam_date: string
  perioexam_notes: string | null
  perioexam_diagnosis: string | null
  perioexam_boneloss: number | null
  perioexam_systemicfactors: boolean | null
  perioexam_toothdata: PerioToothData[]
}

type GeneratePeriodontalChartParams = {
  patientId: string | number
  appointmentDate?: string | null
  patientName?: string | null
  providerName?: string | null
}

type PeriodontalChartResult = {
  fileName: string
  contentType: "application/pdf"
  buffer: Buffer
  examId: number
  examDate: string
}

const BLACK = rgb(0, 0, 0)
const BLUE = rgb(0.05, 0.25, 0.95)
const RED = rgb(0.9, 0, 0)
const ORANGE = rgb(1, 0.48, 0)
const TEAL = rgb(0.05, 0.45, 0.6)
const GREY_TEXT = rgb(0.45, 0.45, 0.45)
const MISSING_TOOTH_NUMBER = rgb(0.68, 0.68, 0.68)
const GRID_GREY = rgb(0.64, 0.64, 0.64)
const SHADE = rgb(0.93, 0.93, 0.93)
const WHITE = rgb(1, 1, 1)
const PURPLE = rgb(0.42, 0.16, 0.72)

const PAGE_W = 1024
const PAGE_H = 768

const CELL_W = 42
const TABLE_W = CELL_W * 16
const LABEL_X = 128
const CHART_X = 176
const SIDE_CAPTION_RIGHT_X = CHART_X - 8

// Layout anchors
// Keep the tooth-number rows centered in the open space between the upper/lower tables.
// These constants prevent the maxillary palatal gap or mandibular facial gap drifting.
const HEADER_FACIAL_TABLE_HEIGHT = 64
const HEADER_NON_FACIAL_TABLE_HEIGHT = 55
const FACIAL_TABLE_HEIGHT = 50
const NON_FACIAL_TABLE_HEIGHT = 40

// Layout anchors
// Keep the tooth-number rows centered in the open space between the upper/lower tables.
// These constants prevent the maxillary palatal gap or mandibular facial gap drifting.
const MAX_FACIAL_TABLE_TOP = 650
const MAX_TOOTH_NUMBER_Y = 494

// Maxillary facial remains the reference blank space for later tooth overlay.
// The palatal and mandibular lingual tables are pulled close to the arch divider
// so they nearly touch it with an equal visual gap.
const TOOTH_OVERLAY_SPACE = 86

const ARCH_DIVIDER_Y = 365
const ARCH_DIVIDER_GAP = 6

const MAX_PALATAL_TABLE_TOP =
  ARCH_DIVIDER_Y + ARCH_DIVIDER_GAP + NON_FACIAL_TABLE_HEIGHT

const MAND_TOOTH_NUMBER_Y = 208
const MAND_LINGUAL_TABLE_TOP = ARCH_DIVIDER_Y - ARCH_DIVIDER_GAP
const MAND_FACIAL_TABLE_TOP = MAND_TOOTH_NUMBER_Y - TOOTH_OVERLAY_SPACE

function safeFileName(value: string | null | undefined) {
  return String(value || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
}

function normaliseDate(value: string | null | undefined) {
  if (!value) return ""
  return String(value).slice(0, 10)
}

function formatDateAu(value: string | null | undefined) {
  const date = normaliseDate(value)
  if (!date) return ""
  const [yyyy, mm, dd] = date.split("-")
  if (!yyyy || !mm || !dd) return date
  return `${dd}/${mm}/${yyyy}`
}

function getNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function getTooth(teeth: PerioToothData[], toothNumber: number) {
  return teeth.find((tooth) => getNumber(tooth.toothNumber) === toothNumber)
}

function isMissing(tooth: PerioToothData | undefined) {
  return !tooth || Number(tooth.typeId) === 3
}

function sortTeeth(teeth: PerioToothData[]) {
  return [...teeth].sort(
    (a, b) => getNumber(a.toothNumber) - getNumber(b.toothNumber)
  )
}

function pocketColour(depth: number) {
  if (depth >= 7) return RED
  if (depth >= 4) return ORANGE
  return BLACK
}

function isLeftPraktikaTooth(toothNumber: number) {
  return (
    (toothNumber >= 11 && toothNumber <= 18) ||
    (toothNumber >= 41 && toothNumber <= 48)
  )
}

function orderedSites(toothNumber: number): ["D" | "M", "C", "D" | "M"] {
  return isLeftPraktikaTooth(toothNumber) ? ["D", "C", "M"] : ["M", "C", "D"]
}

function isMaxillaryMolar(toothNumber: number) {
  return [16, 17, 18, 26, 27, 28].includes(toothNumber)
}

function isMandibularMolar(toothNumber: number) {
  return [36, 37, 38, 46, 47, 48].includes(toothNumber)
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: {
    font: PDFFont
    size?: number
    color?: ReturnType<typeof rgb>
  }
) {
  page.drawText(String(text ?? ""), {
    x,
    y,
    size: opts.size || 7,
    font: opts.font,
    color: opts.color || BLACK,
  })
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: {
    font: PDFFont
    size?: number
    color?: ReturnType<typeof rgb>
  }
) {
  const size = opts.size || 7
  const textWidth = opts.font.widthOfTextAtSize(String(text), size)

  drawText(page, text, x + width / 2 - textWidth / 2, y, {
    font: opts.font,
    size,
    color: opts.color,
  })
}

function siteValues(
  tooth: PerioToothData | undefined,
  toothNumber: number,
  side: "B" | "L",
  prefix: string
) {
  if (isMissing(tooth)) return ["", "", ""]

  return orderedSites(toothNumber).map((site) => {
    const value = getNumber(tooth![`${prefix}_${side}_${site}`])
    return String(value)
  })
}

function oneValue(tooth: PerioToothData | undefined, key: string) {
  if (isMissing(tooth)) return ""
  return String(getNumber(tooth![key]))
}

function furcationValues(
  tooth: PerioToothData | undefined,
  toothNumber: number,
  side: "B" | "L"
) {
  if (isMissing(tooth)) return [""]

  if (isMandibularMolar(toothNumber)) {
    return [
      String(
        getNumber(tooth![`FUR_${side}_C`]) ||
          getNumber(tooth![`fur_${side.toLowerCase()}_c`])
      ),
    ]
  }

  if (isMaxillaryMolar(toothNumber)) {
    if (side === "B") {
      return [
        String(
          getNumber(tooth![`FUR_${side}_C`]) ||
            getNumber(tooth![`fur_${side.toLowerCase()}_c`])
        ),
      ]
    }

    return [
      String(
        getNumber(tooth![`FUR_${side}_D`]) ||
          getNumber(tooth![`fur_${side.toLowerCase()}_l`])
      ),
      String(
        getNumber(tooth![`FUR_${side}_M`]) ||
          getNumber(tooth![`fur_${side.toLowerCase()}_r`])
      ),
    ]
  }

  return [""]
}

function drawThreeSiteValues(params: {
  page: PDFPage
  font: PDFFont
  cellX: number
  y: number
  values: string[]
  color: ReturnType<typeof rgb> | ReturnType<typeof rgb>[]
}) {
  const { page, font, cellX, y, values, color } = params
  const startX = cellX + CELL_W / 2 - 10

  values.forEach((value, index) => {
    const rowColor = Array.isArray(color) ? color[index] : color

    drawText(page, value, startX + index * 9, y, {
      font,
      size: 6.6,
      color: rowColor,
    })
  })
}

function drawOneCenteredValue(params: {
  page: PDFPage
  font: PDFFont
  cellX: number
  y: number
  value: string
  color?: ReturnType<typeof rgb>
}) {
  drawCenteredText(params.page, params.value, params.cellX, params.y, CELL_W, {
    font: params.font,
    size: 6.6,
    color: params.color || BLACK,
  })
}

function drawFurcation(params: {
  page: PDFPage
  font: PDFFont
  cellX: number
  y: number
  values: string[]
}) {
  const cleanValues = params.values.filter((value) => value !== "")

  if (cleanValues.length === 0) return

  if (cleanValues.length === 1) {
    drawOneCenteredValue({
      page: params.page,
      font: params.font,
      cellX: params.cellX,
      y: params.y,
      value: cleanValues[0],
      color: PURPLE,
    })
    return
  }

  const startX = params.cellX + CELL_W / 2 - 5
  cleanValues.forEach((value, index) => {
    drawText(params.page, value, startX + index * 10, params.y, {
      font: params.font,
      size: 6.6,
      color: PURPLE,
    })
  })
}

function drawTableBackground(params: {
  page: PDFPage
  chartX: number
  yTop: number
  height: number
  toothCount: number
}) {
  const tableWidth = params.toothCount * CELL_W

  params.page.drawRectangle({
    x: params.chartX,
    y: params.yTop - params.height,
    width: tableWidth,
    height: params.height,
    color: SHADE,
    opacity: 0.9,
  })
}

function drawWhiteToothDividers(params: {
  page: PDFPage
  x: number
  yTop: number
  height: number
  toothCount: number
}) {
  for (let i = 0; i <= params.toothCount; i++) {
    const dividerX = params.x + i * CELL_W

    params.page.drawLine({
      start: { x: dividerX, y: params.yTop },
      end: { x: dividerX, y: params.yTop - params.height },
      color: WHITE,
      thickness: 3.2,
    })
  }
}

function drawRowLabels(params: {
  page: PDFPage
  font: PDFFont
  boldFont: PDFFont
  rowKind: "facial" | "palatal" | "lingual"
  x: number
  yTop: number
}) {
  const labels =
    params.rowKind === "facial"
      ? ["depth (pocket)", "recession", "loss of attachment", "mobility", "furcation"]
      : ["depth (pocket)", "recession", "loss of attachment", "furcation"]

  labels.forEach((label, index) => {
    const fontToUse = index === 0 ? params.boldFont : params.font
    const size = 6.4

    const textWidth = fontToUse.widthOfTextAtSize(label, size)

    drawText(
      params.page,
      label,
      params.x - textWidth,
      params.yTop - 11 - index * 9,
      {
        font: fontToUse,
        size,
        color: BLACK,
      }
    )
  })
}

function drawToothNumberRow(params: {
  page: PDFPage
  boldFont: PDFFont
  teeth: PerioToothData[]
  toothNumbers: number[]
  x: number
  y: number
}) {
  params.toothNumbers.forEach((toothNumber, index) => {
    const tooth = getTooth(params.teeth, toothNumber)

    const color = isMissing(tooth) ? MISSING_TOOTH_NUMBER : rgb(0.02, 0.24, 0.62)

    drawCenteredText(
      params.page,
      String(toothNumber),
      params.x + index * CELL_W,
      params.y,
      CELL_W,
      {
        font: params.boldFont,
        size: 7,
        color,
      }
    )
  })
}

function drawSiteHeader(params: {
  page: PDFPage
  boldFont: PDFFont
  teeth: PerioToothData[]
  toothNumbers: number[]
  x: number
  y: number
}) {
  params.toothNumbers.forEach((toothNumber, index) => {
    const tooth = getTooth(params.teeth, toothNumber)
    if (isMissing(tooth)) return

    const cellX = params.x + index * CELL_W
    const labels = orderedSites(toothNumber)

    drawThreeSiteValues({
      page: params.page,
      font: params.boldFont,
      cellX,
      y: params.y,
      values: labels,
      color: [rgb(1, 0, 1), BLUE, BLACK],
    })
  })
}

function drawNumberTable(params: {
  page: PDFPage
  font: PDFFont
  boldFont: PDFFont
  teeth: PerioToothData[]
  toothNumbers: number[]
  x: number
  yTop: number
  side: "B" | "L"
  rowKind: "facial" | "palatal" | "lingual"
  includeSiteHeader: boolean
}) {
  const tableHeight = params.includeSiteHeader
    ? params.rowKind === "facial"
      ? HEADER_FACIAL_TABLE_HEIGHT
      : HEADER_NON_FACIAL_TABLE_HEIGHT
    : params.rowKind === "facial"
      ? FACIAL_TABLE_HEIGHT
      : NON_FACIAL_TABLE_HEIGHT
  const tableWidth = params.toothNumbers.length * CELL_W

  // Header tables need a slightly larger gap between the D/C/M divider
  // and the first numeric row so the white divider does not cross the numbers.
  const rowStartY = params.includeSiteHeader ? params.yTop - 22 : params.yTop - 9

  drawTableBackground({
    page: params.page,
    chartX: params.x,
    yTop: params.yTop,
    height: tableHeight,
    toothCount: params.toothNumbers.length,
  })

  drawWhiteToothDividers({
    page: params.page,
    x: params.x,
    yTop: params.yTop,
    height: tableHeight,
    toothCount: params.toothNumbers.length,
  })

  drawRowLabels({
    page: params.page,
    font: params.font,
    boldFont: params.boldFont,
    rowKind: params.rowKind,
    x: params.x - 8,
    yTop: rowStartY + 11,
  })

  if (params.includeSiteHeader) {
    drawSiteHeader({
      page: params.page,
      boldFont: params.boldFont,
      teeth: params.teeth,
      toothNumbers: params.toothNumbers,
      x: params.x,
      y: params.yTop - 9,
    })

    // D/C/M divider: raised slightly and given more breathing room
    // above the first numeric row.
    params.page.drawLine({
      start: { x: params.x, y: params.yTop - 13 },
      end: { x: params.x + tableWidth, y: params.yTop - 13 },
      color: WHITE,
      thickness: 2.2,
    })
  }

  params.toothNumbers.forEach((toothNumber, index) => {
    const cellX = params.x + index * CELL_W
    const tooth = getTooth(params.teeth, toothNumber)

    if (isMissing(tooth)) {
      return
    }

    const pd = siteValues(tooth, toothNumber, params.side, "PRD")
    const gm = siteValues(tooth, toothNumber, params.side, "REC")
    const cal = pd.map((pdValue, siteIndex) =>
      String(getNumber(pdValue) + getNumber(gm[siteIndex]))
    )
    const mobility = oneValue(tooth, "mobility")
    const furcation = furcationValues(tooth, toothNumber, params.side)

    drawThreeSiteValues({
      page: params.page,
      font: params.font,
      cellX,
      y: rowStartY,
      values: pd,
      color: pd.map((v) => pocketColour(getNumber(v))),
    })

    drawThreeSiteValues({
      page: params.page,
      font: params.font,
      cellX,
      y: rowStartY - 9,
      values: gm,
      color: BLUE,
    })

    drawThreeSiteValues({
      page: params.page,
      font: params.font,
      cellX,
      y: rowStartY - 18,
      values: cal,
      color: BLACK,
    })

    if (params.rowKind === "facial") {
      drawOneCenteredValue({
        page: params.page,
        font: params.font,
        cellX,
        y: rowStartY - 27,
        value: mobility === "0" ? "0" : mobility,
        color: BLACK,
      })

      drawFurcation({
        page: params.page,
        font: params.font,
        cellX,
        y: rowStartY - 36,
        values: furcation,
      })
    } else {
      drawFurcation({
        page: params.page,
        font: params.font,
        cellX,
        y: rowStartY - 27,
        values: furcation,
      })
    }
  })
}

function drawSideCaption(params: {
  page: PDFPage
  boldFont: PDFFont
  text: string
  rightX: number
  y: number
}) {
  const size = 12

  params.text.split("\n").forEach((line, index) => {
    const textWidth = params.boldFont.widthOfTextAtSize(line, size)

    drawText(params.page, line, params.rightX - textWidth, params.y - index * 16, {
      font: params.boldFont,
      size,
      color: TEAL,
    })
  })
}

function drawToothRow(params: {
  page: PDFPage
  teeth: PerioToothData[]
  toothNumbers: number[]
  x: number
  y: number
  side: "B" | "L"
}) {
  if (!DRAW_TEETH) return

  params.toothNumbers.forEach((toothNumber, index) => {
    const tooth = getTooth(params.teeth, toothNumber)
if (toothNumber === 17 && params.side === "B") {
  console.log("PRAKTIKA TOOTH DATA", JSON.stringify(tooth, null, 2))
}
    drawPraktikaToothWithClinicalMarkers({
      page: params.page,
      tooth,
      toothNumber,
      x: params.x + index * CELL_W + 4,
      y: params.y,
      side: params.side,
    })
  })
}

async function getPatientPerioExamIds(
  patientId: string | number,
  mode: PraktikaSessionMode
) {
  const response = await withPraktikaAutoRefresh(
    () =>
      requestPraktikaJson({
        path: "/php/forms/db_getFormData.php",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: `${PRAKTIKA_APP_BASE_URL}/v2/scheduler`,
        },
        body: JSON.stringify([
          {
            parameters: [
              {
                practice_id: PRAKTIKA_PRACTICE_ID,
                patient_id: Number(patientId),
              },
            ],
            fields: [
              "patient_perioexamids",
              "patient_medicalhistory",
              "patient_images",
            ],
          },
        ]),
        mode,
      }),
    { mode }
  )

  const first = Array.isArray(response) ? response[0] : response
  const ids = first?.patient_perioexamids

  if (!Array.isArray(ids)) return []

  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
}

async function getPerioExams(
  perioExamIds: number[],
  mode: PraktikaSessionMode
) {
  if (perioExamIds.length === 0) return []

  const response = await withPraktikaAutoRefresh(
    () =>
      requestPraktikaJson({
        path: "/php/forms/db_getFormData.php",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: `${PRAKTIKA_APP_BASE_URL}/v2/scheduler`,
        },
        body: JSON.stringify([
          {
            parameters: perioExamIds.map((perioExamId) => ({
              practice_id: PRAKTIKA_PRACTICE_ID,
              perioexam_id: perioExamId,
            })),
            fields: [
              "perioexam_id",
              "perioexam_patientid",
              "perioexam_providerid",
              "perioexam_date",
              "perioexam_notes",
              "perioexam_diagnosis",
              "perioexam_boneloss",
              "perioexam_systemicfactors",
              "perioexam_toothdata",
            ],
          },
        ]),
        mode,
      }),
    { mode }
  )

  if (!Array.isArray(response)) return []

  return response.filter(Boolean) as PerioExam[]
}

function pickExamForDate(exams: PerioExam[], appointmentDate?: string | null) {
  const targetDate = normaliseDate(appointmentDate)

  if (targetDate) {
    const exactMatch = exams.find(
      (exam) => normaliseDate(exam.perioexam_date) === targetDate
    )
    if (exactMatch) return exactMatch
  }

  return [...exams].sort((a, b) =>
    normaliseDate(b.perioexam_date).localeCompare(normaliseDate(a.perioexam_date))
  )[0]
}

async function renderPerioChartPdf(params: {
  exam: PerioExam
  patientName?: string | null
  providerName?: string | null
}) {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([PAGE_W, PAGE_H])

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const teeth = sortTeeth(params.exam.perioexam_toothdata || [])

  const maxillaryTeeth = [
    18, 17, 16, 15, 14, 13, 12, 11,
    21, 22, 23, 24, 25, 26, 27, 28,
  ]

  const mandibularTeeth = [
    48, 47, 46, 45, 44, 43, 42, 41,
    31, 32, 33, 34, 35, 36, 37, 38,
  ]

  drawText(page, `Periodontal Exam for ${params.patientName || "Patient"}`, 14, 742, {
    font: boldFont,
    size: 14,
  })

  drawText(page, `Exam Provider: ${params.providerName || "Not recorded"}`, 14, 725, {
    font: boldFont,
    size: 10,
  })

  drawText(page, `Exam Date: ${formatDateAu(params.exam.perioexam_date)}`, 14, 710, {
    font: boldFont,
    size: 10,
  })

  page.drawLine({
    start: { x: 10, y: 694 },
    end: { x: 1014, y: 694 },
    color: BLACK,
    thickness: 0.65,
  })

  // MAXILLA — FACIAL DATA
  drawNumberTable({
    page,
    font,
    boldFont,
    teeth,
    toothNumbers: maxillaryTeeth,
    x: CHART_X,
    yTop: MAX_FACIAL_TABLE_TOP,
    side: "B",
    rowKind: "facial",
    includeSiteHeader: true,
  })

  drawSideCaption({
    page,
    boldFont,
    text: "FACIAL\n(BUCCAL)",
    rightX: SIDE_CAPTION_RIGHT_X,
    y: 562,
  })

  // MAXILLA MIDLINE
  drawText(page, "MAXILLA", 76, MAX_TOOTH_NUMBER_Y, {
    font: boldFont,
    size: 9,
    color: GREY_TEXT,
  })

  drawToothNumberRow({
    page,
    boldFont,
    teeth,
    toothNumbers: maxillaryTeeth,
    x: CHART_X,
    y: MAX_TOOTH_NUMBER_Y,
  })

  // MAXILLA — PALATAL DATA
  drawSideCaption({
    page,
    boldFont,
    text: "PALATAL\n(LINGUAL)",
    rightX: SIDE_CAPTION_RIGHT_X,
    y: 450,
  })

  drawNumberTable({
    page,
    font,
    boldFont,
    teeth,
    toothNumbers: maxillaryTeeth,
    x: CHART_X,
    yTop: MAX_PALATAL_TABLE_TOP,
    side: "L",
    rowKind: "palatal",
    includeSiteHeader: false,
  })

  // ARCH DIVIDER
  page.drawLine({
    start: { x: CHART_X - 8, y: ARCH_DIVIDER_Y },
    end: { x: CHART_X + TABLE_W + 8, y: ARCH_DIVIDER_Y },
    color: GRID_GREY,
    thickness: 2.1,
  })

  // MANDIBLE — LINGUAL DATA
  drawNumberTable({
    page,
    font,
    boldFont,
    teeth,
    toothNumbers: mandibularTeeth,
    x: CHART_X,
    yTop: MAND_LINGUAL_TABLE_TOP,
    side: "L",
    rowKind: "lingual",
    includeSiteHeader: true,
  })

  drawSideCaption({
    page,
    boldFont,
    text: "LINGUAL",
    rightX: SIDE_CAPTION_RIGHT_X,
    y: 260,
  })

  // MANDIBLE MIDLINE
  drawText(page, "MANDIBLE", 76, MAND_TOOTH_NUMBER_Y, {
    font: boldFont,
    size: 9,
    color: GREY_TEXT,
  })

  drawToothNumberRow({
    page,
    boldFont,
    teeth,
    toothNumbers: mandibularTeeth,
    x: CHART_X,
    y: MAND_TOOTH_NUMBER_Y,
  })

  // MANDIBLE — FACIAL DATA
  drawSideCaption({
    page,
    boldFont,
    text: "FACIAL",
    rightX: SIDE_CAPTION_RIGHT_X,
    y: 160,
  })

  drawNumberTable({
    page,
    font,
    boldFont,
    teeth,
    toothNumbers: mandibularTeeth,
    x: CHART_X,
    yTop: MAND_FACIAL_TABLE_TOP,
    side: "B",
    rowKind: "facial",
    includeSiteHeader: false,
  })

  // Tooth rows are intentionally left here for later overlay.
  drawToothRow({
    page,
    teeth,
    toothNumbers: maxillaryTeeth,
    x: CHART_X,
    y: 585,
    side: "B",
  })

  drawToothRow({
    page,
    teeth,
    toothNumbers: maxillaryTeeth,
    x: CHART_X,
    y: 398,
    side: "L",
  })

  drawToothRow({
    page,
    teeth,
    toothNumbers: mandibularTeeth,
    x: CHART_X,
    y: 322,
    side: "L",
  })

  drawToothRow({
    page,
    teeth,
    toothNumbers: mandibularTeeth,
    x: CHART_X,
    y: 122,
    side: "B",
  })

  const bytes = await pdfDoc.save()
  return Buffer.from(bytes)
}

export async function generatePeriodontalChartPdf({
  patientId,
  appointmentDate,
  patientName,
  providerName,
}: GeneratePeriodontalChartParams): Promise<PeriodontalChartResult | null> {
  const mode = await getCurrentUserPraktikaSessionMode()

  const ids = await getPatientPerioExamIds(patientId, mode)
  if (ids.length === 0) return null

  const exams = await getPerioExams(ids, mode)
  if (exams.length === 0) return null

  const exam = pickExamForDate(exams, appointmentDate)
  if (!exam) return null

  if (
    appointmentDate &&
    normaliseDate(exam.perioexam_date) !== normaliseDate(appointmentDate)
  ) {
    return null
  }

  const buffer = await renderPerioChartPdf({
    exam,
    patientName,
    providerName,
  })

  return {
    fileName: `${normaliseDate(exam.perioexam_date)} ${safeFileName(
      patientName
    )} Periodontal Chart.pdf`,
    contentType: "application/pdf",
    buffer,
    examId: exam.perioexam_id,
    examDate: exam.perioexam_date,
  }
}