export type RawParsedXeroRow = Record<string, unknown>

export type NormalisedXeroRow = {
  account_name: string
  amount: number
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').replace(/\$/g, '').trim()
    const parsed = Number(cleaned)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function normaliseXeroParserOutput(
  rawRows: RawParsedXeroRow[]
): NormalisedXeroRow[] {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error('No parsed Xero rows were provided')
  }

  const totalsMap = new Map<string, number>()

  for (const row of rawRows) {
    const accountName =
      readString(row.account_name) ||
      readString(row.account) ||
      readString(row.Account) ||
      readString(row['Account Name']) ||
      readString(row['Account']) ||
      readString(row.name)

    const amount =
      readNumber(row.amount) ||
      readNumber(row.Amount) ||
      readNumber(row.total) ||
      readNumber(row.Total) ||
      readNumber(row.value) ||
      readNumber(row.debit) ||
      readNumber(row.Debit)

    if (!accountName) {
      continue
    }

    if (amount < 0) {
      continue
    }

    const currentTotal = totalsMap.get(accountName) || 0
    totalsMap.set(accountName, currentTotal + amount)
  }

  const normalisedRows = Array.from(totalsMap.entries())
    .map(([account_name, amount]) => ({
      account_name,
      amount: Number(amount.toFixed(2)),
    }))
    .sort((a, b) => a.account_name.localeCompare(b.account_name))

  if (normalisedRows.length === 0) {
    throw new Error('No valid Xero account totals could be read from the parsed rows')
  }

  return normalisedRows
}