'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type MappingRow = {
  id?: number;
  xero_account_name: string;
  benchmark_category_name: string;
  notes: string;
};

type BenchmarkRow = {
  category_name: string;
};

const MAPPINGS_API_PATH = '/api/xero-account-mappings';
const BENCHMARKS_API_PATH = '/api/benchmarks';

function emptyRow(): MappingRow {
  return {
    xero_account_name: '',
    benchmark_category_name: '',
    notes: '',
  };
}

export default function BenchmarkMappingsPage() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [benchmarkCategories, setBenchmarkCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function loadPageData() {
    try {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);

      const [mappingsResponse, benchmarksResponse] = await Promise.all([
        fetch(MAPPINGS_API_PATH, {
          method: 'GET',
          cache: 'no-store',
        }),
        fetch(BENCHMARKS_API_PATH, {
          method: 'GET',
          cache: 'no-store',
        }),
      ]);

      const mappingsData = await mappingsResponse.json().catch(() => null);
      const benchmarksData = await benchmarksResponse.json().catch(() => null);

      if (!mappingsResponse.ok) {
        throw new Error(mappingsData?.error || 'Failed to load mappings');
      }

      if (!benchmarksResponse.ok) {
        throw new Error(benchmarksData?.error || 'Failed to load benchmark categories');
      }

      if (!Array.isArray(mappingsData)) {
        throw new Error('Mappings response was not an array');
      }

      if (!Array.isArray(benchmarksData)) {
        throw new Error('Benchmarks response was not an array');
      }

      const cleanedMappings: MappingRow[] = mappingsData.map((row: any) => ({
        id: row.id ? Number(row.id) : undefined,
        xero_account_name: String(row.xero_account_name || ''),
        benchmark_category_name: String(row.benchmark_category_name || ''),
        notes: String(row.notes || ''),
      }));

      const categories = benchmarksData
        .map((row: BenchmarkRow) => String(row.category_name || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      setRows(cleanedMappings);
      setBenchmarkCategories(categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPageData();
  }, []);

  function updateRow(index: number, field: keyof MappingRow, value: string) {
    setRows((current) =>
      current.map((row, i) =>
        i === index
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    );
  }

  function addRow() {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function saveMappings() {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const cleanedRows = rows
        .map((row) => ({
          id: row.id,
          xero_account_name: row.xero_account_name.trim(),
          benchmark_category_name: row.benchmark_category_name.trim(),
          notes: row.notes.trim(),
        }))
        .filter(
          (row) =>
            row.xero_account_name !== '' ||
            row.benchmark_category_name !== '' ||
            row.notes !== ''
        );

      const response = await fetch(MAPPINGS_API_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanedRows),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save mappings');
      }

      setSuccessMessage('Mappings saved successfully.');
      await loadPageData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error saving mappings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Benchmark Mappings
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Match Xero account names to your benchmark categories. Unmapped accounts will follow
              your app’s fallback mapping logic.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/benchmark/expense-reports"
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to Expense Reports
            </Link>

            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add Row
            </button>

            <button
              type="button"
              onClick={saveMappings}
              disabled={saving || loading}
              className="inline-flex items-center rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {saving ? 'Saving...' : 'Save Mappings'}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Mapping Table</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose the benchmark category from the dropdown so your saved mappings always match
              your real benchmark setup.
            </p>
          </div>

          {loading ? (
            <div className="p-5 text-sm text-slate-500">Loading mappings...</div>
          ) : (
            <div className="overflow-x-auto p-5">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Xero Account Name</th>
                    <th className="pb-3 pr-4 font-medium">Benchmark Category</th>
                    <th className="pb-3 pr-4 font-medium">Notes</th>
                    <th className="pb-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id ?? `new-${index}`} className="border-b border-slate-100">
                      <td className="py-3 pr-4 align-top">
                        <input
                          type="text"
                          value={row.xero_account_name}
                          onChange={(e) =>
                            updateRow(index, 'xero_account_name', e.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                          placeholder="e.g. Electricity"
                        />
                      </td>

                      <td className="py-3 pr-4 align-top">
                        <select
                          value={row.benchmark_category_name}
                          onChange={(e) =>
                            updateRow(index, 'benchmark_category_name', e.target.value)
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <option value="">Select benchmark category</option>
                          {benchmarkCategories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="py-3 pr-4 align-top">
                        <input
                          type="text"
                          value={row.notes}
                          onChange={(e) => updateRow(index, 'notes', e.target.value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                          placeholder="Optional notes"
                        />
                      </td>

                      <td className="py-3 align-top">
                        <button
                          type="button"
                          onClick={() => removeRow(index)}
                          className="inline-flex items-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}

                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-slate-500">
                        No mappings found yet. Click “Add Row” to create your first mapping.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}