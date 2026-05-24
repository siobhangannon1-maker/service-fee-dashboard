import { PDFPage, rgb } from "pdf-lib"
import { drawPraktikaToothBlock } from "@/lib/perio/drawPraktikaToothBlock"
import {
  drawPocketGraphBackground,
  drawPocketGraphDepthLines,
} from "@/lib/perio/drawPocketGraph"

type PerioToothData = Record<string, any>
type Side = "B" | "L"
type MarkerState = "N" | "B" | "S" | "BS"

const RED = rgb(1, 0, 0)
const YELLOW = rgb(1, 0.776, 0.2)
const WHITE = rgb(1, 1, 1)
const BLACK = rgb(0, 0, 0)

const GRAPH_WIDTH = 31

/*
  Tooth size is controlled HERE.
  Now that drawPraktikaToothBlock.ts supports real scaling, use normal SVG scale values.

  Suggested range:
    0.35 = small
    0.55 = current
    0.70 = larger
*/
const TOOTH_SCALE = 0.60

/*
  Marker position controls.

  These are independent for each row:
    MAX_FACIAL_MARKER_OFFSET   = maxillary facial / buccal
    MAX_LINGUAL_MARKER_OFFSET  = maxillary palatal / lingual
    MAND_LINGUAL_MARKER_OFFSET = mandibular lingual
    MAND_FACIAL_MARKER_OFFSET  = mandibular facial          

  More positive moves marker upward on the PDF page.
  More negative moves marker downward on the PDF page.
*/
const MAX_FACIAL_MARKER_OFFSET = -40
const MAX_LINGUAL_MARKER_OFFSET = 44
const MAND_LINGUAL_MARKER_OFFSET = -44
const MAND_FACIAL_MARKER_OFFSET = 40

/*
  Set this to true only for a quick visual test.
  It will draw red/yellow markers on every site so you can confirm marker rendering works.
*/
const DEBUG_FORCE_MARKERS = false

function getNumber(value: unknown) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function isUpperArch(toothNumber: number) {
  return toothNumber >= 11 && toothNumber <= 28
}

function isLeftPraktikaTooth(toothNumber: number) {
  return (
    (toothNumber >= 11 && toothNumber <= 18) ||
    (toothNumber >= 41 && toothNumber <= 48)
  )
}

function truthyPerioValue(value: unknown) {
  if (value === true) return true
  if (value === "true") return true
  if (value === "TRUE") return true
  if (value === "yes") return true
  if (value === "YES") return true
  if (value === "Y") return true
  if (value === "y") return true
  if (value === "1") return true
  return getNumber(value) > 0
}

function siteKeysForTooth(toothNumber: number): ["D" | "M", "C", "D" | "M"] {
  return isLeftPraktikaTooth(toothNumber) ? ["D", "C", "M"] : ["M", "C", "D"]
}

function lowerSiteKeysForTooth(
  toothNumber: number
): ["l" | "r", "c", "l" | "r"] {
  return isLeftPraktikaTooth(toothNumber) ? ["l", "c", "r"] : ["r", "c", "l"]
}

function hasExactValue(tooth: PerioToothData, keys: string[]) {
  return keys.some((key) => truthyPerioValue(tooth[key]))
}

function getDepths(
  tooth: PerioToothData,
  toothNumber: number,
  side: Side
): [number, number, number] {
  const s = side.toLowerCase()
  const sites = siteKeysForTooth(toothNumber)
  const lowerSites = lowerSiteKeysForTooth(toothNumber)

  return sites.map((site, index) => {
    const lowerSite = lowerSites[index]

    return getNumber(
      tooth[`PRD_${side}_${site}`] ??
        tooth[`prd_${s}_${lowerSite}`] ??
        tooth[`PRD_${side}_${index === 0 ? "D" : index === 1 ? "C" : "M"}`]
    )
  }) as [number, number, number]
}

function getMarkerState(bleeding: boolean, suppuration: boolean): MarkerState {
  if (bleeding && suppuration) return "BS"
  if (bleeding) return "B"
  if (suppuration) return "S"
  return "N"
}

function getMarkerStates(
  tooth: PerioToothData,
  toothNumber: number,
  side: Side
): [MarkerState, MarkerState, MarkerState] {
  if (DEBUG_FORCE_MARKERS) {
    return ["B", "S", "BS"]
  }

  const s = side.toLowerCase()
  const sites = siteKeysForTooth(toothNumber)
  const lowerSites = lowerSiteKeysForTooth(toothNumber)

  return sites.map((site, index) => {
    const lowerSite = lowerSites[index]

    const bleedingExact = hasExactValue(tooth, [
      `BLD_${side}_${site}`,
      `isBLD_${side}_${site}`,
      `BOP_${side}_${site}`,
      `isBOP_${side}_${site}`,
      `BLE_${side}_${site}`,
      `isBLE_${side}_${site}`,
      `BLEED_${side}_${site}`,
      `isBLEED_${side}_${site}`,

      `bld_${s}_${lowerSite}`,
      `is_bld_${s}_${lowerSite}`,
      `bop_${s}_${lowerSite}`,
      `is_bop_${s}_${lowerSite}`,
      `ble_${s}_${lowerSite}`,
      `is_ble_${s}_${lowerSite}`,
      `bleed_${s}_${lowerSite}`,
      `is_bleed_${s}_${lowerSite}`,
    ])

    const suppurationExact = hasExactValue(tooth, [
      `SUP_${side}_${site}`,
      `isSUP_${side}_${site}`,
      `SUPP_${side}_${site}`,
      `isSUPP_${side}_${site}`,

      `sup_${s}_${lowerSite}`,
      `is_sup_${s}_${lowerSite}`,
      `supp_${s}_${lowerSite}`,
      `is_supp_${s}_${lowerSite}`,
    ])

    /*
      IMPORTANT:
      Use exact site/side keys only.

      The previous loose matching caused duplication because keys like BLD_L_D
      contain the letter "b" in "BLD", so they could incorrectly match the
      buccal/facial side as well as the lingual side.
    */
    return getMarkerState(bleedingExact, suppurationExact)
  }) as [MarkerState, MarkerState, MarkerState]
}

/*
  Filled split diamond using drawSvgPath.

  This avoids page.drawPolygon, which pdf-lib does not support.
  The previous circles were only for debugging; this restores the diamond shape.
*/
function drawSplitDiamond(params: {
  page: PDFPage
  cx: number
  cy: number
  size: number
  state: MarkerState
}) {
  const { page, cx, cy, size, state } = params
  if (state === "N") return

  const leftColor = state === "S" ? YELLOW : RED
  const rightColor = state === "B" ? RED : YELLOW

  // left half
  page.drawLine({
    start: { x: cx, y: cy + size },
    end: { x: cx - size, y: cy },
    color: leftColor,
    thickness: 1.8,
  })

  page.drawLine({
    start: { x: cx - size, y: cy },
    end: { x: cx, y: cy - size },
    color: leftColor,
    thickness: 1.8,
  })

  // right half
  page.drawLine({
    start: { x: cx, y: cy + size },
    end: { x: cx + size, y: cy },
    color: rightColor,
    thickness: 1.8,
  })

  page.drawLine({
    start: { x: cx + size, y: cy },
    end: { x: cx, y: cy - size },
    color: rightColor,
    thickness: 1.8,
  })
}

function drawPraktikaMarkers(params: {
  page: PDFPage
  states: [MarkerState, MarkerState, MarkerState]
  x: number
  y: number
}) {
  const { page, states, x, y } = params
  const siteXs = [x + 7, x + GRAPH_WIDTH / 2, x + GRAPH_WIDTH - 7]

  states.forEach((state, index) => {
    drawSplitDiamond({
      page,
      cx: siteXs[index],
      cy: y,
      size: 2.3,
      state,
    })
  })
}

function markerOffsetForRow(params: {
  isUpper: boolean
  side: Side
}) {
  const { isUpper, side } = params

  if (isUpper && side === "B") return MAX_FACIAL_MARKER_OFFSET
  if (isUpper && side === "L") return MAX_LINGUAL_MARKER_OFFSET
  if (!isUpper && side === "L") return MAND_LINGUAL_MARKER_OFFSET
  return MAND_FACIAL_MARKER_OFFSET
}

export function drawPraktikaToothWithClinicalMarkers(params: {
  page: PDFPage
  tooth: PerioToothData | undefined
  toothNumber: number
  x: number
  y: number
  side: Side
}) {
  const { page, tooth, toothNumber, x, y, side } = params
  if (!tooth || Number(tooth.typeId) === 3) return

  const isUpper = isUpperArch(toothNumber)
  const arch = isUpper ? "maxilla" : "mandible"
  const direction = isUpper ? "up" : "down"

  const graphX = x + 3
  const toothX = graphX + 3

  // Final graph positioning anchors — unchanged.
  const graphBaselineY = isUpper
    ? side === "B"
      ? y - 35 // maxillary facial
      : y + 40 // maxillary palatal
    : side === "L"
      ? y - 60 // mandibular lingual
      : y + 35 // mandibular facial

  // Tooth positioning — unchanged from your current file.
  const toothY = isUpper
    ? side === "B"
      ? y - 18
      : y + 188
    : side === "L"
      ? y - 104
      : y - 10

  const depths = getDepths(tooth, toothNumber, side)

  /*
    Draw order:
    1. grey horizontal graph background first
    2. tooth second, hiding grey horizontal lines under the tooth
    3. coloured depth lines third, visible over the tooth
    4. bleeding/suppuration diamonds last
  */
  drawPocketGraphBackground({
    page,
    x: graphX,
    y: graphBaselineY,
    width: GRAPH_WIDTH,
    direction,
  })

  drawPraktikaToothBlock({
    page,
    toothNumber,
    x: toothX,
    y: toothY,
    arch,
    side,
    scale: TOOTH_SCALE,
  })

  drawPocketGraphDepthLines({
    page,
    x: graphX,
    y: graphBaselineY,
    width: GRAPH_WIDTH,
    direction,
    depths,
  })

  drawPraktikaMarkers({
    page,
    states: getMarkerStates(tooth, toothNumber, side),
    x: graphX,
    y: graphBaselineY + markerOffsetForRow({ isUpper, side }),
  })
}
