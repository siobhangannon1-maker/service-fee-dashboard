import {
  mapXeroExpensesToBenchmarkCategories,
  ParsedXeroExpenseRow,
} from '@/lib/map-xero-expenses-to-benchmarks'
import {
  generateExpenseBenchmarkReport,
  ExpenseBenchmarkReport,
} from '@/lib/generate-expense-benchmark-report'

export async function generateXeroBenchmarkReport(
  year: number,
  month: number,
  parsedXeroRows: ParsedXeroExpenseRow[]
): Promise<ExpenseBenchmarkReport> {
  const groupedBenchmarkRows =
    await mapXeroExpensesToBenchmarkCategories(parsedXeroRows)

  const report = await generateExpenseBenchmarkReport(
    year,
    month,
    groupedBenchmarkRows
  )

  return report
}