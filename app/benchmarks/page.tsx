import { supabase } from '@/lib/supabase'

type ExpenseBenchmark = {
  id: number
  category_name: string
  target_percent: number
  green_min: number
  green_max: number
  orange_min: number
  orange_max: number
  red_min: number
  created_at: string
  updated_at: string
}

export default async function BenchmarksPage() {
  const { data, error } = await supabase
    .from('expense_benchmarks')
    .select('*')
    .order('category_name', { ascending: true })

  if (error) {
    return (
      <main style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
        <h1>Benchmarks</h1>
        <p style={{ color: 'red' }}>Error loading benchmarks: {error.message}</p>
      </main>
    )
  }

  const benchmarks = (data || []) as ExpenseBenchmark[]

  return (
    <main style={{ padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ marginBottom: '20px' }}>Expense Benchmarks</h1>

      {benchmarks.length === 0 ? (
        <p>No benchmark rows found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              width: '100%',
              minWidth: '900px',
              backgroundColor: '#ffffff',
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Target %</th>
                <th style={thStyle}>Green Min</th>
                <th style={thStyle}>Green Max</th>
                <th style={thStyle}>Orange Min</th>
                <th style={thStyle}>Orange Max</th>
                <th style={thStyle}>Red Min</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((benchmark) => (
                <tr key={benchmark.id}>
                  <td style={tdStyle}>{benchmark.category_name}</td>
                  <td style={tdStyle}>{Number(benchmark.target_percent).toFixed(2)}%</td>
                  <td style={tdStyle}>{Number(benchmark.green_min).toFixed(2)}%</td>
                  <td style={tdStyle}>{Number(benchmark.green_max).toFixed(2)}%</td>
                  <td style={tdStyle}>{Number(benchmark.orange_min).toFixed(2)}%</td>
                  <td style={tdStyle}>{Number(benchmark.orange_max).toFixed(2)}%</td>
                  <td style={tdStyle}>{Number(benchmark.red_min).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
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