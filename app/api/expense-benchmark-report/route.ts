import { NextResponse } from 'next/server'
import { generateExpenseBenchmarkReport } from '@/lib/generate-expense-benchmark-report'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const year = Number(body.year)
    const month = Number(body.month)
    const items = Array.isArray(body.items) ? body.items : []

    const report = await generateExpenseBenchmarkReport(year, month, items)

    return NextResponse.json(report)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}