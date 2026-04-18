import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

type ReportRow = {
  id: string
  report_month: number
  report_year: number
  month_label: string
  gross_production: number
  total_expenses: number
  total_expense_percent: number
  created_at?: string
}

type ReportItemRow = {
  report_id: string
  category_name: string
  expense_amount: number
  percent: number
  status: 'green' | 'orange' | 'red'
}

export async function GET() {
  try {
    const { data: reportRows, error: reportError } = await supabase
      .from('xero_benchmark_reports')
      .select(
        'id, report_month, report_year, month_label, gross_production, total_expenses, total_expense_percent, created_at'
      )
      .order('report_year', { ascending: false })
      .order('report_month', { ascending: false })

    if (reportError) {
      return NextResponse.json(
        { error: reportError.message },
        { status: 500 }
      )
    }

    const reports = (reportRows || []) as ReportRow[]

    if (reports.length === 0) {
      return NextResponse.json({
        reports: [],
      })
    }

    const reportIds = reports.map((report) => report.id)

    const { data: itemRows, error: itemError } = await supabase
      .from('xero_benchmark_report_items')
      .select('report_id, category_name, expense_amount, percent, status')
      .in('report_id', reportIds)
      .order('category_name', { ascending: true })

    if (itemError) {
      return NextResponse.json(
        { error: itemError.message },
        { status: 500 }
      )
    }

    const items = (itemRows || []) as ReportItemRow[]

    const reportsWithItems = reports.map((report) => ({
      id: report.id,
      report_month: report.report_month,
      report_year: report.report_year,
      month_label: report.month_label,
      gross_production: Number(report.gross_production || 0),
      total_expenses: Number(report.total_expenses || 0),
      total_expense_percent: Number(report.total_expense_percent || 0),
      created_at: report.created_at || null,
      items: items
        .filter((item) => item.report_id === report.id)
        .map((item) => ({
          category_name: item.category_name,
          expense_amount: Number(item.expense_amount || 0),
          percent: Number(item.percent || 0),
          status: item.status,
        })),
    }))

    return NextResponse.json({
      reports: reportsWithItems,
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