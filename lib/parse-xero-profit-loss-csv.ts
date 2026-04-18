import Papa from 'papaparse'

export type ParsedXeroExpenseRow = {
  account_name: string
  amount: number
}

function parseMoney(value: string | null | undefined): number {
  if (!value) return 0

  const cleaned = value.replace(/\$/g, '').replace(/,/g, '').trim()
  const parsed = Number(cleaned)

  return Number.isNaN(parsed) ? 0 : parsed
}

function normalize(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\s+/g, ' ').trim()
}

export function parseXeroProfitLossCsv(csvText: string): ParsedXeroExpenseRow[] {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: false,
  })

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`)
  }

  const rows = parsed.data

  if (!rows || rows.length === 0) {
    throw new Error('No rows found in CSV')
  }

  let inOperatingExpenses = false
  const expenseRows: ParsedXeroExpenseRow[] = []

  for (const row of rows) {
    const firstColumn = normalize(row[0])
    const secondColumn = normalize(row[1])

    if (!firstColumn && !secondColumn) {
      continue
    }

    if (firstColumn === 'Operating Expenses') {
      inOperatingExpenses = true
      continue
    }

    if (!inOperatingExpenses) {
      continue
    }

    if (
      firstColumn === 'Total Operating Expenses' ||
      firstColumn === 'Net Profit' ||
      firstColumn === 'Profit' ||
      firstColumn === 'Loss'
    ) {
      break
    }

    if (
      firstColumn === 'Account' ||
      firstColumn.startsWith('Total ') ||
      firstColumn === 'Gross Profit' ||
      firstColumn === 'Trading Income'
    ) {
      continue
    }

    const amount = parseMoney(secondColumn)

    if (!firstColumn || amount <= 0) {
      continue
    }

    expenseRows.push({
      account_name: firstColumn,
      amount,
    })
  }

  if (expenseRows.length === 0) {
    throw new Error(
      'No operating expense rows were found in the Xero Profit and Loss CSV'
    )
  }

  return expenseRows
}