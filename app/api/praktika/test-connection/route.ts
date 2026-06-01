import { NextResponse } from "next/server";
import { praktikaPost } from "@/lib/praktika/praktika-client";

export async function GET() {
  try {
    const result = await praktikaPost<any>({
      path: "/php/json/db_reportingDataWarehouse.php",
      contentType: "form",
      referer:
        "https://praktika.praktika.net.au/v2/reports/upcoming-appointments",
      body: {
        sReportName: "appointments",
        bByCreationTime: "false",
        "iPracticeIds[]": ["1181"],
        sFromDate: "2026-06-01",
        sToDate: "2026-06-01",
      },
    });

    return NextResponse.json({
      connected: true,
      resultCount: Array.isArray(result) ? result.length : "not-array",
      sample: Array.isArray(result) ? result[0] : result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error ? error.message : "Unknown Praktika error",
      },
      { status: 500 }
    );
  }
}