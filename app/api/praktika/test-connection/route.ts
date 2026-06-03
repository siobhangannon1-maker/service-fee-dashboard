import { NextResponse } from "next/server";
import { praktikaHelperPostForCurrentUser } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

    const result = await praktikaHelperPostForCurrentUser<any>({
      jobType: "praktika_test_connection",
      priority: 10,
      path: "/php/json/db_reportingDataWarehouse.php",
      contentType: "form",
      referer:
        "https://praktika.praktika.net.au/v2/reports/upcoming-appointments",
      timeoutMs: 90_000,
      body: {
        sReportName: "appointments",
        bByCreationTime: "false",
        "iPracticeIds[]": [practiceId],
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
      { status: 500 },
    );
  }
}
