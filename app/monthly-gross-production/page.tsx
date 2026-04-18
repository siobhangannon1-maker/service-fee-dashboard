'use client'

import { useEffect, useState } from 'react'

type MonthlyGrossProductionRow = {
  id: number
  month_key: string
  year: number
  month: number
  gross_production: number
  source: string | null
  created_at: string
  updated_at: string
}

export default function MonthlyGrossProductionPage() {
  const [year, setYear] = useState('2026')
  const [month, setMonth] = useState('3')
  const [grossProduction, setGrossProduction] = useState('')
  const [rows, setRows] = useState<MonthlyGrossProductionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadRows()
  }, [])

  async function loadRows() {
    try {
      setLoading(true)
      setError('')
      const response = await fetch('/api/monthly-gross-production')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load monthly gross production')
      }

      setRows(data)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load monthly gross production'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      setSaving(true)
      setError('')
      setMessage('')

      const response = await fetch('/api/monthly-gross-production', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          year: Number(year),
          month: Number(month),
          gross_production: Number(grossProduction),
          source: 'manual entry',
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save monthly gross production')
      }

      setMessage('Monthly gross production saved successfully')
      setGrossProduction('')
      await loadRows()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save monthly gross production'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Monthly Gross Production</h1>
      <p style={{ marginBottom: '20px' }}>
        Save one gross production total per month. This will be used later when
        calculating expense percentages from your Xero uploads.
      </p>

      {message && <div style={successStyle}>{message}</div>}
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
          <label style={labelStyle}>Gross Production Total</label>
          <input
            type="number"
            step="0.01"
            value={grossProduction}
            onChange={(e) => setGrossProduction(e.target.value)}
            style={inputStyle}
            placeholder="125000.00"
            min="0"
            required
          />
        </div>

        <button type="submit" disabled={saving} style={buttonStyle}>
          {saving ? 'Saving...' : 'Save Monthly Total'}
        </button>
      </form>

      <hr style={{ margin: '30px 0' }} />

      <h2 style={{ marginBottom: '12px' }}>Saved Monthly Totals</h2>

      {loading ? (
        <p>Loading...</p>
      ) : rows.length === 0 ? (
        <p>No monthly gross production rows found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Month Key</th>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>Month</th>
                <th style={thStyle}>Gross Production</th>
                <th style={thStyle}>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.month_key}</td>
                  <td style={tdStyle}>{row.year}</td>
                  <td style={tdStyle}>{row.month}</td>
                  <td style={tdStyle}>
                    ${Number(row.gross_production).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td style={tdStyle}>{row.source || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  maxWidth: '500px',
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

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  minWidth: '700px',
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

const successStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '12px',
  backgroundColor: '#dcfce7',
  color: '#166534',
  borderRadius: '8px',
}

const errorStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '12px',
  backgroundColor: '#fee2e2',
  color: '#991b1b',
  borderRadius: '8px',
}