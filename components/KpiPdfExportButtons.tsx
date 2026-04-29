"use client";

import { useState } from "react";

type KpiPdfExportButtonsProps = {
  targetId: string;
  fileName?: string;
};

export default function KpiPdfExportButtons({
  targetId,
  fileName = "practice-kpis",
}: KpiPdfExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false);

  async function exportPdf() {
    setIsExporting(true);

    try {
      const target = document.getElementById(targetId);

      if (!target) {
        alert("Could not find the KPI report section to export.");
        return;
      }

      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f8fafc",
        windowWidth: target.scrollWidth,
      });

      const imageData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imageWidth = pageWidth;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;

      let heightLeft = imageHeight;
      let position = 0;

      pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imageHeight;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", 0, position, imageWidth, imageHeight);
        heightLeft -= pageHeight;
      }

      const today = new Date().toISOString().slice(0, 10);
      pdf.save(`${fileName}-${today}.pdf`);
    } catch (error) {
      console.error(error);
      alert("PDF export failed. Please check the console for details.");
    } finally {
      setIsExporting(false);
    }
  }

  function printPage() {
    window.print();
  }

  return (
    <div style={wrapperStyle}>
      <button
        type="button"
        onClick={exportPdf}
        disabled={isExporting}
        style={{
          ...primaryButtonStyle,
          opacity: isExporting ? 0.65 : 1,
          cursor: isExporting ? "not-allowed" : "pointer",
        }}
      >
        {isExporting ? "Exporting..." : "Export PDF"}
      </button>

      <button type="button" onClick={printPage} style={secondaryButtonStyle}>
        Print / Save
      </button>
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid #2563eb",
  borderRadius: "14px",
  backgroundColor: "#2563eb",
  color: "#ffffff",
  padding: "13px 18px",
  minWidth: "145px",
  fontSize: "13px",
  fontWeight: 900,
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.18)",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid #bfdbfe",
  borderRadius: "14px",
  backgroundColor: "#eff6ff",
  color: "#1d4ed8",
  padding: "13px 18px",
  minWidth: "145px",
  fontSize: "13px",
  fontWeight: 900,
  cursor: "pointer",
};
