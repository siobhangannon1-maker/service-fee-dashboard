import { supabase } from '@/lib/supabase'

export type ParsedXeroExpenseRow = {
  account_name: string
  amount: number
}

export type GroupedBenchmarkExpenseRow = {
  category_name: string
  expense_amount: number
}

export async function mapXeroExpensesToBenchmarkCategories(
  rows: ParsedXeroExpenseRow[]
): Promise<GroupedBenchmarkExpenseRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('At least one parsed Xero expense row is required')
  }

  const cleanedRows = rows.map((row) => ({
    account_name: String(row.account_name || '').trim(),
    amount: Number(row.amount),
  }))

  for (const row of cleanedRows) {
    if (!row.account_name) {
      throw new Error('Each parsed Xero row must include an account_name')
    }

    if (Number.isNaN(row.amount)) {
      throw new Error(`Amount must be a valid number for ${row.account_name}`)
    }

    // Negative amounts are allowed
  }

  const uniqueAccountNames = [...new Set(cleanedRows.map((row) => row.account_name))]

  const { data: mappingRows, error: mappingError } = await supabase
    .from('xero_account_mappings')
    .select('*')
    .in('xero_account_name', uniqueAccountNames)

  if (mappingError) {
    throw new Error(mappingError.message)
  }

  const mappingMap = new Map(
    (mappingRows || []).map((row) => [row.xero_account_name, row.benchmark_category_name])
  )

  const groupedTotals = new Map<string, number>()

  for (const row of cleanedRows) {
    const benchmarkCategoryName =
      mappingMap.get(row.account_name) || 'Other Expenses'

    const currentTotal = groupedTotals.get(benchmarkCategoryName) || 0
    groupedTotals.set(
      benchmarkCategoryName,
      currentTotal + row.amount
    )
  }

  const groupedRows: GroupedBenchmarkExpenseRow[] = Array.from(groupedTotals.entries())
    .map(([category_name, expense_amount]) => ({
      category_name,
      expense_amount: Number(expense_amount.toFixed(2)),
    }))
    .sort((a, b) => a.category_name.localeCompare(b.category_name))

  return groupedRows
}