'use client'

import { useEffect, useState } from 'react'

type MappingRow = {
  id?: number
  xero_account_name: string
  benchmark_category_name: string
  notes: string
}

type BenchmarkOption = {
  id: number
  category_name: string
}

export default function XeroAccountMappingsPage() {
  const [mappings, setMappings] = useState<MappingRow[]>([])
  const [benchmarkCategories, setBenchmarkCategories] = useState<BenchmarkOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    loadPageData()
  }, [])

  async function loadPageData() {
    try {
      setLoading(true)
      setError('')
      setMessage('')

      const [mappingsResponse, benchmarksResponse] = await Promise.all([
        fetch('/api/xero-account-mappings'),
        fetch('/api/benchmarks'),
      ])

      const mappingsData = await mappingsResponse.json()
      const benchmarksData = await benchmarksResponse.json()

      if (!mappingsResponse.ok) {
        throw new Error(mappingsData.error || 'Failed to load mappings')
      }

      if (!benchmarksResponse.ok) {
        throw new Error(benchmarksData.error || 'Failed to load benchmark categories')
      }

      setMappings(mappingsData)
      setBenchmarkCategories(benchmarksData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page data')
    } finally {
      setLoading(false)
    }
  }

  function updateField(
    index: number,
    field: keyof MappingRow,
    value: string
  ) {
    setMappings((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    )
  }

  function addBlankRow() {
    const defaultCategory =
      benchmarkCategories.length > 0 ? benchmarkCategories[0].category_name : ''

    setMappings((current) => [
      ...current,
      {
        xero_account_name: '',
        benchmark_category_name: defaultCategory,
        notes: '',
      },
    ])
  }

  async function handleSave() {
    try {
      setSaving(true)
      setError('')
      setMessage('')

      const filteredMappings = mappings.filter(
        (row) => row.xero_account_name.trim() !== ''
      )

      const response = await fetch('/api/xero-account-mappings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filteredMappings),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save mappings')
      }

      setMessage('Mappings saved successfully')
      setMappings(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mappings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <h1 style={headingStyle}>Xero Account Mappings</h1>
        <p>Loading...</p>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Xero Account Mappings</h1>
      <p style={{ marginBottom: '20px' }}>
        Map each Xero account name to one benchmark category used in your dashboard.
      </p>

      {message && <div style={successStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ marginBottom: '16px' }}>
        <button onClick={addBlankRow} style={secondaryButtonStyle}>
          Add Mapping Row
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Xero Account Name</th>
              <th style={thStyle}>Benchmark Category</th>
              <th style={thStyle}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((row, index) => (
              <tr key={row.id ?? `new-${index}`}>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={row.xero_account_name}
                    onChange={(e) =>
                      updateField(index, 'xero_account_name', e.target.value)
                    }
                    style={inputStyle}
                    placeholder="e.g. Electricity"
                  />
                </td>

                <td style={tdStyle}>
                  <select
                    value={row.benchmark_category_name}
                    onChange={(e) =>
                      updateField(index, 'benchmark_category_name', e.target.value)
                    }
                    style={inputStyle}
                  >
                    {benchmarkCategories.map((category) => (
                      <option key={category.id} value={category.category_name}>
                        {category.category_name}
                      </option>
                    ))}
                  </select>
                </td>

                <td style={tdStyle}>
                  <input
                    type="text"
                    value={row.notes}
                    onChange={(e) =>
                      updateField(index, 'notes', e.target.value)
                    }
                    style={inputStyle}
                    placeholder="Optional notes"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '20px' }}>
        <button onClick={handleSave} disabled={saving} style={buttonStyle}>
          {saving ? 'Saving...' : 'Save Mappings'}
        </button>
      </div>
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

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  minWidth: '900px',
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px',
  fontSize: '14px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
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
}

const secondaryButtonStyle: React.CSSProperties = {
  backgroundColor: '#e5e7eb',
  color: '#111827',
  border: 'none',
  borderRadius: '8px',
  padding: '10px 16px',
  fontSize: '14px',
  cursor: 'pointer',
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