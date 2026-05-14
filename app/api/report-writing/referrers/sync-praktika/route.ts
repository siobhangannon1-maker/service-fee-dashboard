import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type PraktikaReferralRow = {
  vchProvider?: string
  vchClinic?: string
  vchStreetAddress?: string
  vchSuburb?: string
  vchPostCode?: string
  vchState?: string
  vchEmail?: string
  iReferralCount?: string
  mnyTotalReceived?: string
  totalIncoming?: string
  totalOutgoing?: string
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim()
}

function buildAddress(row: PraktikaReferralRow): string {
  const street = cleanText(row.vchStreetAddress)
  const suburb = cleanText(row.vchSuburb)
  const state = cleanText(row.vchState)
  const postcode = cleanText(row.vchPostCode)

  const suburbLine = [suburb, state, postcode].filter(Boolean).join(" ")

  return [street, suburbLine].filter(Boolean).join("\n")
}

function buildPraktikaKey(row: PraktikaReferralRow): string {
  return [
    cleanText(row.vchProvider).toLowerCase(),
    cleanText(row.vchClinic).toLowerCase(),
    cleanText(row.vchStreetAddress).toLowerCase(),
    cleanText(row.vchSuburb).toLowerCase(),
    cleanText(row.vchPostCode).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|")
}

async function importRows(rows: PraktikaReferralRow[]) {
  const referrerMap = new Map<string, {
    praktika_referrer_key: string
    name: string
    practice_name: string | null
    address: string | null
    email: string | null
    is_active: boolean
    raw_json: PraktikaReferralRow
    synced_at: string
    updated_at: string
  }>()

  for (const row of rows) {
    const name = cleanText(row.vchProvider)
    const practiceName = cleanText(row.vchClinic)
    const address = buildAddress(row)
    const email = cleanText(row.vchEmail)
    const praktikaKey = buildPraktikaKey(row)

    if (!name || !praktikaKey) continue

    referrerMap.set(praktikaKey, {
      praktika_referrer_key: praktikaKey,
      name,
      practice_name: practiceName || null,
      address: address || null,
      email: email || null,
      is_active: true,
      raw_json: row,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  const referrers = Array.from(referrerMap.values())

  const { error } = await supabase
    .from("report_referrers")
    .upsert(referrers, {
      onConflict: "praktika_referrer_key",
    })

  if (error) {
    throw new Error(error.message)
  }

  return {
    imported: referrers.length,
    skipped: rows.length - referrers.length,
  }
}
  
export async function POST() {
  try {
    const cookie = process.env.PRAKTIKA_COOKIE

    if (!cookie) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing PRAKTIKA_COOKIE. Refresh Praktika session first.",
        },
        { status: 500 }
      )
    }

    const today = new Date().toISOString().slice(0, 10)

    const formData = new URLSearchParams()
    formData.set("sReportName", "referrals")
    formData.set("iPracticeId", "1181")
    formData.set("sFromDate", "2000-01-01")
    formData.set("sToDate", today)
    formData.set("sMode", "PROVIDER_IN")

    const response = await fetch(
      "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/plain, */*",
          Origin: "https://praktika.praktika.net.au",
          Referer: "https://praktika.praktika.net.au/v2/reports/referrals",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
        body: formData.toString(),
        cache: "no-store",
      }
    )

    const responseText = await response.text()

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Praktika request failed: ${response.status}`,
          preview: responseText.slice(0, 500),
        },
        { status: 500 }
      )
    }

    let parsedRows: unknown

    try {
      parsedRows = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Praktika returned non-JSON response.",
          preview: responseText.slice(0, 500),
        },
        { status: 500 }
      )
    }

    if (!Array.isArray(parsedRows)) {
      return NextResponse.json(
        {
          success: false,
          error: "Praktika did not return a valid array.",
          preview: responseText.slice(0, 500),
        },
        { status: 500 }
      )
    }

    const result = await importRows(parsedRows as PraktikaReferralRow[])

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      totalRows: parsedRows.length,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Praktika referrers.",
      },
      { status: 500 }
    )
  }
}