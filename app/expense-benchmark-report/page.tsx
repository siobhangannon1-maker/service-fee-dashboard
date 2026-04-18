'use client'

import { useEffect, useState } from 'react'
import {
  BenchmarkStatus,
  getStatusColors,
  getStatusLabel,
} from '@/lib/benchmark-status'

type BenchmarkOption = {
  id: number
  category_name: string
}

type ExpenseInputRow = {
  id: number
  category_name: string
  expense_amount: string
}

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

export default function ExpenseBenchmarkReportPage() {
  const [year, setYear] = useState('2026')
  const [month, setMonth] = useState('3')
  const [categories, setCategories] = useState<BenchmarkOption[]>([])
  const [rows, setRows] = useState<ExpenseInputRow[]>([])
  const [report, setReport] = useState<ReportData | null>(null)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    try {
      setLoadingCategories(true)
      setError('')

      const response = await fetch('/api/benchmarks')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load categories')
      }

      setCategories(data)

      const initialRows = (data || []).map((category: BenchmarkOption) => ({
        id: category.id,
        category_name: category.category_name,
        expense_amount: '',
      }))

      setRows(initialRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories')
    } finally {
      setLoadingCategories(false)
    }
  }

  function updateRow(id: number, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, expense_amount: value } : row
      )
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      setSubmitting(true)
      setError('')
      setReport(null)

      const filteredItems = rows
        .filter((row) => row.expense_amount !== '' && Number(row.expense_amount) > 0)
        .map((row) => ({
          category_name: row.category_name,
          expense_amount: Number(row.expense_amount),
        }))

      if (filteredItems.length === 0) {
        throw new Error('Please enter at least one expense amount greater than 0')
      }

      const response = await fetch('/api/expense-benchmark-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          items: filteredItems,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate report')
      }

      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Expense Benchmark Report</h1>
      <p style={{ marginBottom: '20px' }}>
        Enter the expense totals for a month. The app will use the saved gross
        production for that month and compare each category against its benchmark.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <form onSubmit={handleSubmit} style={formStyle}>
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
              required
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
              required
            />
          </div>
        </div>

        <h2 style={{ marginTop: '10px', marginBottom: '10px' }}>
          Expense Totals by Category
        </h2>

        {loadingCategories ? (
          <p>Loading categories...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Expense Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.category_name}</td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.expense_amount}
                        onChange={(e) => updateRow(row.id, e.target.value)}
                        style={inputStyle}
                        placeholder="0.00"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button type="submit" disabled={submitting} style={buttonStyle}>
          {submitting ? 'Generating Report...' : 'Generate Report'}
        </button>
      </form>

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

const formStyle: React.CSSProperties = {
  display: 'grid',
  gap: '16px',
  marginTop: '20px',
}

const topFieldsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
}

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  minWidth: '140px',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  padding: '10px',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 16px',
  fontSize: '14px',
  cursor: 'pointer',
  width: 'fit-content',
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