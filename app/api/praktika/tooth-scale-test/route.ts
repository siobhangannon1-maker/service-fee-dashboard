import { NextResponse } from "next/server"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { drawPraktikaToothBlock } from "@/lib/perio/drawPraktikaToothBlock"

export const dynamic = "force-dynamic"

function drawDiamond(params: {
  page: any
  cx: number
  cy: number
  size: number
  color: ReturnType<typeof rgb>
}) {
  const { page, cx, cy, size, color } = params

  page.drawSvgPath(
    `M ${cx} ${cy + size} L ${cx - size} ${cy} L ${cx} ${cy - size} L ${cx + size} ${cy} Z`,
    {
      color,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.4,
    }
  )
}

export async function GET() {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([900, 500])
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  page.drawText("Praktika Tooth Scale + Marker Test", {
    x: 30,
    y: 460,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  })

  const testScales = [0.25, 0.4, 0.55, 0.7, 1]

  testScales.forEach((scale, index) => {
    const x = 70 + index * 160
    const y = 260

    page.drawText(`scale ${scale}`, {
      x: x - 20,
      y: y + 120,
      size: 9,
      font,
      color: rgb(0, 0, 0),
    })

    page.drawLine({
      start: { x: x - 30, y },
      end: { x: x + 60, y },
      color: rgb(1, 0.65, 0.65),
      thickness: 1.2,
    })

    drawPraktikaToothBlock({
      page,
      toothNumber: 46,
      x,
      y,
      arch: "mandible",
      side: "B",
      scale,
    })

    // Marker visibility tests — drawn AFTER tooth, so should appear on top.
    page.drawCircle({
  x,
  y: y + 60,
  size: 6,
  color: rgb(1, 0, 0),
})

page.drawCircle({
  x: x - 14,
  y: y + 45,
  size: 6,
  color: rgb(1, 0.776, 0.2),
})

page.drawCircle({
  x: x + 14,
  y: y + 45,
  size: 6,
  color: rgb(1, 0, 0),
})
  })

  const bytes = await pdfDoc.save()

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="tooth-scale-test.pdf"',
      "Cache-Control": "no-store",
    },
  })
}