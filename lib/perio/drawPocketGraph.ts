import { PDFPage, rgb } from "pdf-lib"

export type PerioGraphDirection = "up" | "down"

const DEFAULT_GRAPH_WIDTH = 36
const MM_STEP = 3.2
const MAX_MM = 10

function praktikaPocketColour(depth: number) {
  if (depth < 4) return rgb(0, 0.816, 0.012)
  if (depth < 7) return rgb(1, 0.576, 0.09)
  return rgb(0.906, 0.169, 0)
}

/*
  Draws only the grey horizontal mm graph and pink gingival band.

  Use this BEFORE drawing the tooth so the horizontal graph lines sit
  underneath the tooth.
*/
export function drawPocketGraphBackground(params: {
  page: PDFPage
  x: number
  y: number
  width?: number
  direction: PerioGraphDirection
}) {
  const { page, x, y, width = DEFAULT_GRAPH_WIDTH, direction } = params

  const sign = direction === "up" ? 1 : -1

  for (let i = 0; i <= MAX_MM; i++) {
    const yy = y + sign * i * MM_STEP

    page.drawLine({
      start: { x, y: yy },
      end: { x: x + width, y: yy },
      color:
        i === 0 || i === 5 || i === 10
          ? rgb(0.74, 0.74, 0.74)
          : rgb(0.86, 0.86, 0.86),
      thickness:
        i === 0 || i === 5 || i === 10
          ? 0.7
          : 0.45,
    })
  }

  page.drawRectangle({
    x,
    y: y - 2.5,
    width,
    height: 5,
    color: rgb(1, 0.76, 0.74),
    opacity: 0.55,
  })
}

/*
  Draws only the coloured probing depth/mm lines.

  Use this AFTER drawing the tooth so the coloured lines sit visibly
  on top of the tooth.
*/
export function drawPocketGraphDepthLines(params: {
  page: PDFPage
  x: number
  y: number
  width?: number
  direction: PerioGraphDirection
  depths: [number, number, number]
}) {
  const { page, x, y, width = DEFAULT_GRAPH_WIDTH, direction, depths } = params

  const sign = direction === "up" ? 1 : -1
  const siteXs = [x + 7, x + width / 2, x + width - 7]

  depths.forEach((depth, index) => {
    if (!depth || depth <= 0) return

    const clampedDepth = Math.min(MAX_MM, Math.max(0, depth))
    const length = clampedDepth * MM_STEP

    page.drawLine({
      start: { x: siteXs[index], y },
      end: { x: siteXs[index], y: y + sign * length },
      color: praktikaPocketColour(depth),

      /*
        Increased thickness only.
        x/y values, MM_STEP, graph width and measurements are unchanged.
      */
      thickness: depth >= 7 ? 2.4 : depth >= 4 ? 2.1 : 1.8,
    })
  })
}

/*
  Backwards-compatible full graph function.
  Existing callers can still use drawPocketGraph() as before.
*/
export function drawPocketGraph(params: {
  page: PDFPage
  x: number
  y: number
  width?: number
  direction: PerioGraphDirection
  depths: [number, number, number]
}) {
  drawPocketGraphBackground({
    page: params.page,
    x: params.x,
    y: params.y,
    width: params.width,
    direction: params.direction,
  })

  drawPocketGraphDepthLines({
    page: params.page,
    x: params.x,
    y: params.y,
    width: params.width,
    direction: params.direction,
    depths: params.depths,
  })
}
