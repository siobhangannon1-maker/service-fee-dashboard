import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { requestPraktikaJson } from "@/lib/praktika/praktika-request";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";
const PRACTICE_MODE = { scope: "practice" as const };

export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const json = await withPraktikaAutoRefresh(
      () =>
        requestPraktikaJson({
          path: "/php/json/db_gridPatientList.php",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Referer: "https://praktika.praktika.net.au/v2/patients",
          },
          body: JSON.stringify({
            startRow: 0,
            endRow: 10,
            rowGroupCols: [],
            valueCols: [],
            pivotCols: [],
            pivotMode: false,
            groupKeys: [],
            filterModel: {},
            practiceIds: [Number(PRAKTIKA_PRACTICE_ID)],
            searchMode: "AND",
            sortModel: [
              { sort: "asc", colId: "lastName", caseSensitive: false },
              { sort: "asc", colId: "firstName", caseSensitive: false },
            ],
          }),
          mode: PRACTICE_MODE,
        }),
      {
        mode: PRACTICE_MODE,
      },
    );

    if (json?.exception) {
      return NextResponse.json(
        {
          success: false,
          practiceId: PRAKTIKA_PRACTICE_ID,
          error:
            json.exception.message ||
            "Praktika returned an exception.",
          rawPreview: json,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      practiceId: PRAKTIKA_PRACTICE_ID,
      keys: Object.keys(json || {}),
      rowCount: Array.isArray(json?.rows) ? json.rows.length : null,
      firstRows: Array.isArray(json?.rows) ? json.rows.slice(0, 3) : null,
      rawPreview: json,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Raw Praktika grid test failed.",
      },
      { status: 500 },
    );
  }
}
