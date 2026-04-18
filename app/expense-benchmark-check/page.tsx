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

type ResultData = {
  month_key: string
  year: number
  month: number
  category_name: string
  expense_amount: number
  gross_production: number
  actual_percent: number
  target_percent: number
  variance_from_target: number
  status: BenchmarkStatus
}

export default function ExpenseBenchmarkCheckPage() {
  const [year, setYear] = useState('2026')
  const [month, setMonth] = useState('3')
  const [categoryName, setCategoryName] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [categories, setCategories] = useState<BenchmarkOption[]>([])
  const [result, setResult] = useState<ResultData | null>(null)
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

      if (data.length > 0) {
        setCategoryName(data[0].category_name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories')
    } finally {
      setLoadingCategories(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      setSubmitting(true)
      setError('')
      setResult(null)

      const response = await fetch('/api/expense-benchmark-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          category_name: categoryName,
          expense_amount: Number(expenseAmount),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to calculate benchmark')
      }

      setResult(data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to calculate benchmark'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const statusColors = result ? getStatusColors(result.status) : null

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Expense Benchmark Check</h1>
      <p style={{ marginBottom: '20px' }}>
        Enter a month, choose an expense category, and enter an expense total.
        The app will look up gross production for that month, calculate the
        percentage, and compare it to your saved benchmark.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <form onSubmit={handleSubmit} style={formStyle}>
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

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Expense Category</label>
          <select
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            style={inputStyle}
            disabled={loadingCategories}
            required
          >
            {categories.map((category) => (
              <option key={category.id} value={category.category_name}>
                {category.category_name}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Expense Amount</label>
          <input
            type="number"
            step="0.01"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            style={inputStyle}
            placeholder="12000.00"
            min="0"
            required
          />
        </div>

        <button type="submit" disabled={submitting} style={buttonStyle}>
          {submitting ? 'Calculating...' : 'Check Benchmark'}
        </button>
      </form>

      {result && statusColors && (
        <div
          style={{
            ...resultCardStyle,
            backgroundColor: statusColors.background,
            border: `1px solid ${statusColors.border}`,
            color: statusColors.text,
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: '12px' }}>
            {getStatusLabel(result.status)}
          </h2>

          <div style={resultsGridStyle}>
            <div>
              <strong>Month:</strong>
              <div>{result.month_key}</div>
            </div>

            <div>
              <strong>Category:</strong>
              <div>{result.category_name}</div>
            </div>

            <div>
              <strong>Expense Amount:</strong>
              <div>
                $
                {Number(result.expense_amount).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            <div>
              <strong>Gross Production:</strong>
              <div>
                $
                {Number(result.gross_production).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>

            <div>
              <strong>Actual %:</strong>
              <div>{result.actual_percent.toFixed(2)}%</div>
            </div>

            <div>
              <strong>Target %:</strong>
              <div>{result.target_percent.toFixed(2)}%</div>
            </div>

            <div>
              <strong>Variance from Target:</strong>
              <div>{result.variance_from_target.toFixed(2)}%</div>
            </div>

            <div>
              <strong>Status:</strong>
              <div style={{ textTransform: 'capitalize' }}>{result.status}</div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
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
  maxWidth: '520px',
  marginTop: '20px',
}

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  padding: '10px',
  border: '1px solid #cbd5e1',
  borderRadius: '8px',
  fontSize: '14px',
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

const resultCardStyle: React.CSSProperties = {
  marginTop: '28px',
  padding: '20px',
  borderRadius: '12px',
}

const resultsGridStyle: React.CSSProperties = {
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