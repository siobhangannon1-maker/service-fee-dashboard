'use client'

import { useState } from 'react'
import {
  BenchmarkStatus,
  getStatusColors,
  getStatusLabel,
} from '@/lib/benchmark-status'

type ResultRow = {
  category_name: string
  expense_amount: number
  actual_percent: number
  target_percent: number
  variance_from_target: number
  status: BenchmarkStatus
}

type ReportData = {
  month_key: string
  year: number
  month: number
  gross_production: number
  total_expenses: number
  total_expense_percent: number
  results: ResultRow[]
}

const starterJson = `[
  { "account_name": "Wages and Salaries", "amount": 25000 },
  { "account_name": "Superannuation", "amount": 5000 },
  { "account_name": "Advertising", "amount": 3000 },
  { "account_name": "Lab Fees", "amount": 10000 }
]`

export default function TestXeroBenchmarkReportPage() {
  const [year, setYear] = useState('2026')
  const [month, setMonth] = useState('3')
  const [jsonText, setJsonText] = useState(starterJson)
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRunReport() {
    try {
      setLoading(true)
      setError('')
      setReport(null)

      const parsedRows = JSON.parse(jsonText)

      const response = await fetch('/api/xero-benchmark-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          rows: parsedRows,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate Xero benchmark report')
      }

      setReport(data)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate Xero benchmark report'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Test Xero Benchmark Report</h1>
      <p style={{ marginBottom: '20px' }}>
        Paste parsed Xero account totals below, choose a month, and generate the
        full benchmark report in one step.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={topFieldsRowStyle}>
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={inputStyle}
            min="2000"
            max="2100"
          />
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Month</label>
          <input
            type="number"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={inputStyle}
            min="1"
            max="12"
          />
        </div>
      </div>

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>Parsed Xero JSON</label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={textareaStyle}
        />
      </div>

      <button onClick={handleRunReport} disabled={loading} style={buttonStyle}>
        {loading ? 'Generating Report...' : 'Generate Xero Benchmark Report'}
      </button>

      {report && (
        <>
          <div style={summaryCardStyle}>
            <h2 style={{ marginTop: 0 }}>Month Summary</h2>
            <div style={summaryGridStyle}>
              <div>
                <strong>Month</strong>
                <div>{report.month_key}</div>
              </div>
              <div>
                <strong>Gross Production</strong>
                <div>{formatCurrency(report.gross_production)}</div>
              </div>
              <div>
                <strong>Total Expenses</strong>
                <div>{formatCurrency(report.total_expenses)}</div>
              </div>
              <div>
                <strong>Total Expense %</strong>
                <div>{report.total_expense_percent.toFixed(2)}%</div>
              </div>
            </div>
          </div>

          <h2 style={{ marginTop: '28px', marginBottom: '12px' }}>
            Benchmark Results
          </h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Expense Amount</th>
                  <th style={thStyle}>Actual %</th>
                  <th style={thStyle}>Target %</th>
                  <th style={thStyle}>Variance</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((row) => {
                  const colors = getStatusColors(row.status)

                  return (
                    <tr key={row.category_name}>
                      <td style={tdStyle}>{row.category_name}</td>
                      <td style={tdStyle}>{formatCurrency(row.expense_amount)}</td>
                      <td style={tdStyle}>{row.actual_percent.toFixed(2)}%</td>
                      <td style={tdStyle}>{row.target_percent.toFixed(2)}%</td>
                      <td style={tdStyle}>{row.variance_from_target.toFixed(2)}%</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '6px 10px',
                            borderRadius: '999px',
                            backgroundColor: colors.background,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                            fontWeight: 600,
                          }}
                        >
                          {getStatusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}

function formatCurrency(value: number) {
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const pageStyle: React.CSSProperties = {
  padding: '24px',
  fontFamily: 'Arial, sans-serif',
}

const headingStyle: React.CSSProperties = {
  marginBottom: '12px',
}

const topFieldsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
  marginBottom: '16px',
}

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  maxWidth: '800px',
  marginBottom: '16px',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  padding: '10px',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  fontSize: '14px',
  minWidth: '140px',
}

const textareaStyle: React.CSSProperties = {
  minHeight: '220px',
  padding: '12px',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  fontSize: '14px',
  fontFamily: 'monospace',
}

const buttonStyle: React.CSSProperties = {
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 16px',
  fontSize: '14px',
  cursor: 'pointer',
}

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  minWidth: '800px',
  backgroundColor: '#ffffff',
}

const thStyle: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '12px',
  textAlign: 'left',
  backgroundColor: '#f3f4f6',
  fontWeight: 700,
}

const tdStyle: React.CSSProperties = {
  border: '1px solid #d1d5db',
  padding: '12px',
}

const summaryCardStyle: React.CSSProperties = {
  marginTop: '28px',
  padding: '20px',
  backgroundColor: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
}

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '16px',
}

const errorStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '12px',
  backgroundColor: '#fee2e2',
  color: '#991b1b',
  borderRadius: '8px',
}