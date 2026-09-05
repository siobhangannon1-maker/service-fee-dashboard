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

    const cleanedRows = body.map((row) => {
      const base: any = {
        xero_account_name: String(row.xero_account_name || '').trim(),
        benchmark_category_name: String(row.benchmark_category_name || '').trim(),
        notes: row.notes ? String(row.notes) : '',
      }

      // only include id when it's a truthy numeric value (existing rows)
      if (row && (row.id || row.id === 0)) {
        const parsed = Number(row.id)
        if (!Number.isNaN(parsed)) base.id = parsed
      }

      return base
    })

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

    // Partition rows into those that have an explicit id (updates) and new rows (inserts)
    const rowsWithId = cleanedRows.filter((r) => typeof r.id === 'number')
    // rows without an `id` property will allow Postgres to generate identity values
    const rowsWithoutId = cleanedRows.filter((r) => typeof r.id !== 'number')

    const savedRows: any[] = []

    // 1) Upsert/update rows that include an id (use identity PK for matching)
    if (rowsWithId.length > 0) {
      const { data: upsertedById, error: upsertIdError } = await supabase
        .from('xero_account_mappings')
        .upsert(rowsWithId, { onConflict: 'id' })
        .select('*')

      if (upsertIdError) {
        return NextResponse.json({ error: upsertIdError.message }, { status: 500 })
      }

      if (upsertedById) savedRows.push(...upsertedById)
    }

    // 2) Insert or upsert by xero_account_name for new rows without id.
    // This preserves the unique constraint on xero_account_name: new rows will be inserted
    // and if a row with the same xero_account_name already exists it will be updated.
    if (rowsWithoutId.length > 0) {
      // Insert new rows without sending an `id` field so Postgres identity generates it.
      const { data: inserted, error: insertError } = await supabase
        .from('xero_account_mappings')
        .insert(rowsWithoutId)
        .select('*')

      if (insertError) {
        // Return DB error (e.g. unique constraint violation) to caller
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      if (inserted) savedRows.push(...inserted)
    }

    // Deduplicate savedRows by id (in case of overlap)
    const mergedById: Record<string, any> = {}
    for (const r of savedRows) {
      if (r && r.id != null) mergedById[String(r.id)] = r
    }

    const result = Object.values(mergedById)

    return NextResponse.json({ message: 'Mappings saved successfully', data: result })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown server error',
      },
      { status: 500 }
    )
  }
}