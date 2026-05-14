"use client"

import { useEffect, useState } from "react"

type AuditEvent = {
  id: string
  actor_full_name: string | null
  actor_initials: string | null
  actor_email: string | null
  action: string
  created_at: string
}

type Props = {
  draftId: string
}

export default function LetterAuditTrail({ draftId }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([])

  async function loadEvents() {
    const response = await fetch(
      `/api/report-writing/get-audit-events?draftId=${draftId}`
    )

    const data = await response.json()

    if (data.success) {
      setEvents(data.events)
    }
  }

  useEffect(() => {
    loadEvents()
  }, [draftId])

  return (
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="font-bold">Letter Audit Trail</h3>

      <div className="mt-3 space-y-2">
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">
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
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white"
            >
              {event.actor_initials || "?"}
            </div>

            <div>
              <div className="text-sm font-semibold">{event.action}</div>
              <div className="text-xs text-slate-500">
                {new Date(event.created_at).toLocaleString("en-AU")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}