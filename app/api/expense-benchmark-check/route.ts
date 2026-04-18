import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getBenchmarkStatus } from '@/lib/benchmark-status'

function buildMonthKey(year: number, month: number) {
  const paddedMonth = String(month).padStart(2, '0')
  return `${year}-${paddedMonth}`
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const year = Number(body.year)
    const month = Number(body.month)
    const categoryName = String(body.category_name || '')
    const expenseAmount = Number(body.expense_amount)

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

    if (!categoryName) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      )
    }

    if (Number.isNaN(expenseAmount) || expenseAmount < 0) {
      return NextResponse.json(
        { error: 'Expense amount must be a valid non-negative number' },
        { status: 400 }
      )
    }

    const monthKey = buildMonthKey(year, month)

    const { data: grossProductionRow, error: grossProductionError } =
      await supabase
        .from('monthly_gross_production')
        .select('*')
        .eq('month_key', monthKey)
        .single()

    if (grossProductionError || !grossProductionRow) {
      return NextResponse.json(
        {
          error: `No monthly gross production found for ${monthKey}. Save that month first.`,
        },
        { status: 404 }
      )
    }

    const { data: benchmarkRow, error: benchmarkError } = await supabase
      .from('expense_benchmarks')
      .select('*')
      .eq('category_name', categoryName)
      .single()

    if (benchmarkError || !benchmarkRow) {
      return NextResponse.json(
        {
          error: `No benchmark found for category: ${categoryName}`,
        },
        { status: 404 }
      )
    }

    const grossProduction = Number(grossProductionRow.gross_production)

    if (grossProduction <= 0) {
      return NextResponse.json(
        {
          error: `Gross production for ${monthKey} must be greater than 0`,
        },
        { status: 400 }
      )
    }

    const actualPercent = (expenseAmount / grossProduction) * 100
    const status = getBenchmarkStatus(actualPercent, benchmarkRow)
    const varianceFromTarget = actualPercent - Number(benchmarkRow.target_percent)

    return NextResponse.json({
      month_key: monthKey,
      year,
      month,
      category_name: categoryName,
      expense_amount: expenseAmount,
      gross_production: grossProduction,
      actual_percent: Number(actualPercent.toFixed(2)),
      target_percent: Number(Number(benchmarkRow.target_percent).toFixed(2)),
      variance_from_target: Number(varianceFromTarget.toFixed(2)),
      status,
      benchmark: benchmarkRow,
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