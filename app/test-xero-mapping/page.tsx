'use client'

import { useState } from 'react'

type GroupedRow = {
  category_name: string
  expense_amount: number
}

const starterJson = `[
  { "account_name": "Wages and Salaries", "amount": 25000 },
  { "account_name": "Superannuation", "amount": 5000 },
  { "account_name": "Advertising", "amount": 3000 },
  { "account_name": "Lab Fees", "amount": 10000 }
]`

export default function TestXeroMappingPage() {
  const [jsonText, setJsonText] = useState(starterJson)
  const [groupedRows, setGroupedRows] = useState<GroupedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleTest() {
    try {
      setLoading(true)
      setError('')
      setGroupedRows([])

      const parsedRows = JSON.parse(jsonText)

      const response = await fetch('/api/test-xero-mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rows: parsedRows,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to test mapping')
      }

      setGroupedRows(data.grouped_rows || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to test mapping')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Test Xero Mapping</h1>
      <p style={{ marginBottom: '20px' }}>
        Paste parsed Xero account totals below and test how they are grouped into
        benchmark categories using your saved mappings.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>Parsed Xero JSON</label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          style={textareaStyle}
        />
      </div>

      <button onClick={handleTest} disabled={loading} style={buttonStyle}>
        {loading ? 'Testing...' : 'Test Mapping'}
      </button>

      {groupedRows.length > 0 && (
        <>
          <h2 style={{ marginTop: '28px', marginBottom: '12px' }}>
            Grouped Benchmark Categories
          </h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Benchmark Category</th>
                  <th style={thStyle}>Expense Amount</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((row) => (
                  <tr key={row.category_name}>
                    <td style={tdStyle}>{row.category_name}</td>
                    <td style={tdStyle}>
                      ${Number(row.expense_amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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

const fieldGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  maxWidth: '800px',
}

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
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
  marginTop: '16px',
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
  minWidth: '600px',
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

const errorStyle: React.CSSProperties = {
  marginBottom: '16px',
  padding: '12px',
  backgroundColor: '#fee2e2',
  color: '#991b1b',
  borderRadius: '8px',
}