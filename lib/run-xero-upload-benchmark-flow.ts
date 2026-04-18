import { normaliseXeroParserOutput, RawParsedXeroRow } from '@/lib/normalise-xero-parser-output'
import { generateXeroBenchmarkReport } from '@/lib/generate-xero-benchmark-report'

export async function runXeroUploadBenchmarkFlow(
  year: number,
  month: number,
  rawParsedRows: RawParsedXeroRow[]
) {
  const normalisedRows = normaliseXeroParserOutput(rawParsedRows)

  const report = await generateXeroBenchmarkReport(year, month, normalisedRows)

  return {
    normalised_rows: normalisedRows,
    report,
  }
}