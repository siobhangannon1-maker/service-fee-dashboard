"use client"

import { useRef } from "react"
import html2canvas from "html2canvas"
import jsPDF from "jspdf"

type ApprovedLetterPdfPreviewProps = {
  patientName: string
  patientDob: string
  referrerName: string
  letterText: string
}

export default function ApprovedLetterPdfPreview({
  patientName,
  patientDob,
  referrerName,
  letterText,
}: ApprovedLetterPdfPreviewProps) {
  const pdfRef = useRef<HTMLDivElement>(null)

  async function generatePdf() {
    if (!pdfRef.current) return

    const canvas = await html2canvas(pdfRef.current, {
      scale: 2,
      useCORS: true,
    })

    const imageData = canvas.toDataURL("image/png")

    const pdf = new jsPDF("p", "mm", "a4")

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()

    const imageWidth = pageWidth
    const imageHeight = (canvas.height * imageWidth) / canvas.width

    let heightLeft = imageHeight
    let position = 0

    pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position = heightLeft - imageHeight
      pdf.addPage()
      pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight)
      heightLeft -= pageHeight
    }

    const safePatientName = patientName
      ? patientName.replace(/[^a-z0-9]/gi, "_")
      : "patient"

    pdf.save(`${safePatientName}_letter.pdf`)
  }

  return (
    <div className="space-y-4">
      <button
        onClick={generatePdf}
        className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white"
      >
        Generate PDF
      </button>

      <div
        ref={pdfRef}
        className="mx-auto min-h-[1123px] w-[794px] bg-white p-12 text-slate-950 shadow"
      >
        <div className="border-b pb-6">
          <h1 className="text-2xl font-bold">Focus Oral and Maxillofacial Surgery</h1>
          <p className="mt-1 text-sm text-slate-600">
            Specialist Oral and Maxillofacial Surgery
          </p>
        </div>

        <div className="mt-8 text-sm text-slate-700">
          <p>
            <strong>Patient:</strong> {patientName || "Not entered"}
          </p>
          <p>
            <strong>DOB:</strong> {patientDob || "Not entered"}
          </p>
          <p>
            <strong>Referrer:</strong> {referrerName || "Not entered"}
          </p>
        </div>

        <div className="mt-8 whitespace-pre-wrap text-[15px] leading-7">
          {letterText}
        </div>

        <div className="mt-12 border-t pt-4 text-xs text-slate-500">
          This document was generated from an approved temporary draft.
        </div>
      </div>
    </div>
  )
}