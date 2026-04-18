import { NextResponse } from 'next/server'
import { runXeroUploadBenchmarkFlow } from '@/lib/run-xero-upload-benchmark-flow'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const year = Number(body.year)
    const month = Number(body.month)
    const rawParsedRows = Array.isArray(body.rows) ? body.rows : []

    const result = await runXeroUploadBenchmarkFlow(year, month, rawParsedRows)

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}