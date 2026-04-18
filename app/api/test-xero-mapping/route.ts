import { NextResponse } from 'next/server'
import { mapXeroExpensesToBenchmarkCategories } from '@/lib/map-xero-expenses-to-benchmarks'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const rows = Array.isArray(body.rows) ? body.rows : []

    const groupedRows = await mapXeroExpensesToBenchmarkCategories(rows)

    return NextResponse.json({
      grouped_rows: groupedRows,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}