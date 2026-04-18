import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('xero_account_mappings')
    .select('*')
    .order('xero_account_name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be an array' },
        { status: 400 }
      )
    }

    const cleanedRows = body.map((row) => ({
      id: row.id ? Number(row.id) : undefined,
      xero_account_name: String(row.xero_account_name || '').trim(),
      benchmark_category_name: String(row.benchmark_category_name || '').trim(),
      notes: row.notes ? String(row.notes) : '',
    }))

    for (const row of cleanedRows) {
      if (!row.xero_account_name) {
        return NextResponse.json(
          { error: 'Xero account name is required' },
          { status: 400 }
        )
      }

      if (!row.benchmark_category_name) {
        return NextResponse.json(
          { error: `Benchmark category is required for ${row.xero_account_name}` },
          { status: 400 }
        )
      }
    }

    const { data, error } = await supabase
      .from('xero_account_mappings')
      .upsert(cleanedRows, { onConflict: 'id' })
      .select()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Mappings saved successfully',
      data,
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