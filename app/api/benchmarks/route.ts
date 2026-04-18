import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type BenchmarkRowInput = {
  id?: number | null
  category_name: string
  target_percent: number
  green_min: number
  green_max: number
  orange_min: number
  orange_max: number
  red_min: number
}

export async function GET() {
  const { data, error } = await supabase
    .from('expense_benchmarks')
    .select('*')
    .order('category_name', { ascending: true })

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

    const cleanedRows: BenchmarkRowInput[] = body.map((row) => ({
      id:
        row.id === undefined || row.id === null || row.id === ''
          ? undefined
          : Number(row.id),
      category_name: String(row.category_name || '').trim(),
      target_percent: Number(row.target_percent),
      green_min: Number(row.green_min),
      green_max: Number(row.green_max),
      orange_min: Number(row.orange_min),
      orange_max: Number(row.orange_max),
      red_min: Number(row.red_min),
    }))

    for (const row of cleanedRows) {
      if (!row.category_name) {
        return NextResponse.json(
          { error: 'Category name is required' },
          { status: 400 }
        )
      }

      if (
        Number.isNaN(row.target_percent) ||
        Number.isNaN(row.green_min) ||
        Number.isNaN(row.green_max) ||
        Number.isNaN(row.orange_min) ||
        Number.isNaN(row.orange_max) ||
        Number.isNaN(row.red_min)
      ) {
        return NextResponse.json(
          {
            error: `All percentage fields must be valid numbers for ${row.category_name}`,
          },
          { status: 400 }
        )
      }
    }

    const existingRows = cleanedRows.filter((row) => row.id !== undefined)
    const newRows = cleanedRows.filter((row) => row.id === undefined)

    if (existingRows.length > 0) {
      const { error: updateError } = await supabase
        .from('expense_benchmarks')
        .upsert(existingRows)

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        )
      }
    }

    if (newRows.length > 0) {
      const rowsToInsert = newRows.map((row) => ({
        category_name: row.category_name,
        target_percent: row.target_percent,
        green_min: row.green_min,
        green_max: row.green_max,
        orange_min: row.orange_min,
        orange_max: row.orange_max,
        red_min: row.red_min,
      }))

      const { error: insertError } = await supabase
        .from('expense_benchmarks')
        .insert(rowsToInsert)

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        )
      }
    }

    const { data, error } = await supabase
      .from('expense_benchmarks')
      .select('*')
      .order('category_name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: 'Benchmarks saved successfully',
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