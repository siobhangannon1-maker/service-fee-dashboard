'use client'

import { useEffect, useState } from 'react'

type Worker = {
  id: string
  name: string
  type: string
  status: string
  is_paused: boolean
  last_heartbeat_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
}

type AutomationError = {
  id: string
  worker_id: string
  message: string
  created_at: string
}

function formatDate(value: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

export default function AutomationPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [errors, setErrors] = useState<AutomationError[]>([])
  const [loading, setLoading] = useState(true)
  const [busyCommand, setBusyCommand] = useState<string | null>(null)

  async function loadData() {
    const [workersRes, errorsRes] = await Promise.all([
      fetch('/api/automation/workers'),
      fetch('/api/automation/errors'),
    ])

    const workersJson = await workersRes.json()
    const errorsJson = await errorsRes.json()

    setWorkers(workersJson.workers || [])
    setErrors(errorsJson.errors || [])
    setLoading(false)
  }

  async function sendCommand(workerId: string, command: string) {
    setBusyCommand(`${workerId}-${command}`)

    try {
      const res = await fetch('/api/automation/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId, command }),
      })

      const json = await res.json()

      if (!res.ok) {
        alert(json.error || 'Command failed')
      }

      await loadData()
    } finally {
      setBusyCommand(null)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="p-6">Loading automation status...</div>
  }

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automation</h1>
        <p className="text-sm text-gray-500">
          Monitor and control Praktika and MediRef cloud workers.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {workers.map((worker) => (
          <div key={worker.id} className="rounded-lg border bg-white p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{worker.name}</h2>
              <span className="rounded-full border px-3 py-1 text-sm">
                {worker.status}
              </span>
            </div>

            <div className="text-sm space-y-1">
              <p><strong>Worker ID:</strong> {worker.id}</p>
              <p><strong>Paused:</strong> {worker.is_paused ? 'Yes' : 'No'}</p>
              <p><strong>Last heartbeat:</strong> {formatDate(worker.last_heartbeat_at)}</p>
              <p><strong>Last success:</strong> {formatDate(worker.last_success_at)}</p>
              <p><strong>Last error:</strong> {formatDate(worker.last_error_at)}</p>
              {worker.last_error_message && (
                <p className="text-red-600">
                  <strong>Error:</strong> {worker.last_error_message}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {worker.is_paused ? (
                <button
                  className="rounded bg-green-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-resume_worker`}
                  onClick={() => sendCommand(worker.id, 'resume_worker')}
                >
                  Resume
                </button>
              ) : (
                <button
                  className="rounded bg-yellow-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-pause_worker`}
                  onClick={() => sendCommand(worker.id, 'pause_worker')}
                >
                  Pause
                </button>
              )}

              <button
                className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
                disabled={busyCommand === `${worker.id}-soft_restart`}
                onClick={() => sendCommand(worker.id, 'soft_restart')}
              >
                Soft Restart
              </button>

              <button
                className="rounded bg-gray-800 px-3 py-2 text-white disabled:opacity-50"
                disabled={busyCommand === `${worker.id}-force_login`}
                onClick={() => sendCommand(worker.id, 'force_login')}
              >
                Force Login
              </button>

              {worker.type === 'praktika' && (
                <button
                  className="rounded bg-purple-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-run_praktika_sync`}
                  onClick={() => sendCommand(worker.id, 'run_praktika_sync')}
                >
                  Run Praktika Sync
                </button>
              )}

              {worker.type === 'mediref' && (
                <button
                  className="rounded bg-purple-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busyCommand === `${worker.id}-run_mediref_sync`}
                  onClick={() => sendCommand(worker.id, 'run_mediref_sync')}
                >
                  Run MediRef Sync
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Recent Errors</h2>

        {errors.length === 0 ? (
          <p className="text-sm text-gray-500">No errors logged.</p>
        ) : (
          <div className="space-y-3">
            {errors.map((error) => (
              <div key={error.id} className="rounded border p-3 text-sm">
                <p><strong>Worker:</strong> {error.worker_id}</p>
                <p><strong>Time:</strong> {formatDate(error.created_at)}</p>
                <p className="text-red-600"><strong>Error:</strong> {error.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}