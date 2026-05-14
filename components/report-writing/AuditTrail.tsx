"use client"

import { useEffect, useState } from "react"

type AuditEvent = {
  id: string
  actor_full_name: string | null
  actor_initials: string | null
  actor_email: string | null
  action: string
  entity_type: string | null
  patient_name: string | null
  created_at: string
}

type AuditTrailProps = {
  providerId?: string
}

export default function AuditTrail({ providerId }: AuditTrailProps) {
  const [events, setEvents] = useState<AuditEvent[]>([])

  async function loadEvents() {
    const url = providerId
      ? `/api/report-writing/audit?providerId=${providerId}`
      : "/api/report-writing/audit"

    const response = await fetch(url)
    const data = await response.json()

    if (data.success) {
      setEvents(data.events)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [providerId])

  return (
    <div className="rounded-2xl border bg-white p-5">
      <h2 className="text-xl font-bold">Audit Trail</h2>

      <div className="mt-4 space-y-3">
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            No audit events yet.
          </div>
        ) : null}

        {events.map((event) => (
          <div key={event.id} className="flex gap-3 rounded-xl border p-3">
            <div
              title={
                event.actor_full_name ||
                event.actor_email ||
                "Unknown user"
              }
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white"
            >
              {event.actor_initials || "?"}
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">
                {event.action}
              </div>

              <div className="mt-1 text-xs text-slate-500">
                {new Date(event.created_at).toLocaleString("en-AU")}
                {event.patient_name ? ` · ${event.patient_name}` : ""}
                {event.entity_type ? ` · ${event.entity_type}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}