import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

type ReferrerUpsertRow = {
  praktika_referrer_key: string
  name: string
  practice_name: string | null
  address: string | null
  email: string | null
  is_active: boolean
  raw_json: PraktikaReferralRow
  synced_at: string
  updated_at: string
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim()
}

function cleanEmail(value: unknown): string | null {
  const email = cleanText(value).toLowerCase()

  if (!email) return null
  if (!email.includes("@")) return null

  return email
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

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const rows: PraktikaReferralRow[] = Array.isArray(body)
      ? body
      : Array.isArray(body.rows)
        ? body.rows
        : []

    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No referrer rows found in JSON.",
        },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    const validReferrers: ReferrerUpsertRow[] = rows.flatMap((row) => {
      const name = cleanText(row.vchProvider)
      const practiceName = cleanText(row.vchClinic)
      const address = buildAddress(row)
      const email = cleanEmail(row.vchEmail)
      const praktikaKey = buildPraktikaKey(row)

      if (!name || !praktikaKey) return []

      return [
        {
          praktika_referrer_key: praktikaKey,
          name,
          practice_name: practiceName || null,
          address: address || null,
          email,
          is_active: true,
          raw_json: row,
          synced_at: now,
          updated_at: now,
        },
      ]
    })

    if (validReferrers.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid referrers found to sync.",
        },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("report_referrers")
      .upsert(validReferrers, {
        onConflict: "praktika_referrer_key",
      })

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      imported: validReferrers.length,
      skipped: rows.length - validReferrers.length,
      withEmail: validReferrers.filter((referrer) => referrer.email).length,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        success: false,
        error: "Failed to import referrers.",
      },
      { status: 500 }
    )
  }
}