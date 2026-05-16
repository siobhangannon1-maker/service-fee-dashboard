import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const cookie = process.env.PRAKTIKA_COOKIE
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID

    if (!cookie || !practiceId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing Praktika environment variables.",
        },
        { status: 500 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)

    const params = new URLSearchParams()

    params.append("sReportName", "appointments")
    params.append("bByCreationTime", "false")
    params.append("iPracticeIds[]", practiceId)
    params.append("sFromDate", today)
    params.append("sToDate", today)

    const response = await fetch(
      "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
          Origin: "https://praktika.praktika.net.au",
          Referer:
            "https://praktika.praktika.net.au/v2/reports/appointments",
        },
        body: params.toString(),
        cache: "no-store",
      }
    )

    const text = await response.text()

    let parsed: unknown

    try {
      parsed = JSON.parse(text)
    } catch {
      return NextResponse.json({
        success: false,
        error: "Praktika returned non-JSON response.",
        preview: text.slice(0, 1000),
      })
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({
        success: false,
        error: "Praktika response was not an array.",
        preview: parsed,
      })
    }

    return NextResponse.json({
      success: true,
      totalRows: parsed.length,
      sampleRows: parsed.slice(0, 10),
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        success: false,
        error: "Failed to debug Praktika appointments.",
      },
      { status: 500 }
    )
  }
}