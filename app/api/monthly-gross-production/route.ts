import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function buildMonthKey(year: number, month: number) {
  const paddedMonth = String(month).padStart(2, '0')
  return `${year}-${paddedMonth}`
}

export async function GET() {
  const { data, error } = await supabase
    .from('monthly_gross_production')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const year = Number(body.year)
    const month = Number(body.month)
    const grossProduction = Number(body.gross_production)
    const source = body.source ? String(body.source) : 'manual entry'

    if (Number.isNaN(year) || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: 'Year must be a valid number between 2000 and 2100' },
        { status: 400 }
      )
    }

    if (Number.isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'Month must be a valid number between 1 and 12' },
        { status: 400 }
      )
    }

    if (Number.isNaN(grossProduction) || grossProduction < 0) {
      return NextResponse.json(
        { error: 'Gross production must be a valid non-negative number' },
        { status: 400 }
      )
    }

    const monthKey = buildMonthKey(year, month)

    const { data, error } = await supabase
      .from('monthly_gross_production')
      .upsert(
        {
          month_key: monthKey,
          year,
          month,
          gross_production: grossProduction,
          source,
        },
        { onConflict: 'month_key' }
      )
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Monthly gross production saved successfully',
      data,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}