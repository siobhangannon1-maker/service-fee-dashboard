import { NextResponse } from "next/server";
import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRACTICE_MODE = { scope: "practice" as const };

export async function GET() {
  try {
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID;

    if (!practiceId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing PRAKTIKA_PRACTICE_ID.",
        },
        { status: 500 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    const params = new URLSearchParams();
    params.append("sReportName", "appointments");
    params.append("bByCreationTime", "false");
    params.append("iPracticeIds[]", practiceId);
    params.append("sFromDate", today);
    params.append("sToDate", today);

    const parsed = await withPraktikaAutoRefresh(
      () =>
  fetchPraktikaJson(
    params,
    "https://praktika.praktika.net.au/v2/reports/appointments",
    PRACTICE_MODE,
  ),
      {
        mode: PRACTICE_MODE,
      },
    );

    return NextResponse.json({
      success: true,
      totalRows: parsed.length,
      sampleRows: parsed.slice(0, 10),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to debug Praktika appointments.",
      },
      { status: 500 },
    );
  }
}
