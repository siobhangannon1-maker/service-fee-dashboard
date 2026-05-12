"use client";

import { useEffect, useState } from "react";

type AuditEvent = {
  id: string;
  created_at: string;
  event_type: string;
  event_label: string | null;
  details: any;
  actor_email: string | null;
  actor_full_name: string | null;
  actor_initials: string | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-AU");
}

export default function InboxItemAuditTrail({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadAuditTrail() {
      if (!inboxItemId) return;

      setLoading(true);

      try {
        const res = await fetch(`/api/ai/workbench/audit/${inboxItemId}`, {
          cache: "no-store",
        });

        const json = await res.json();

        if (json.ok) {
          setEvents(json.events || []);
        }
      } finally {
        setLoading(false);
      }
    }

    loadAuditTrail();
  }, [inboxItemId]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">Audit trail</div>
          <p className="mt-1 text-xs text-slate-500">
            Recent changes and automation actions for this item.
          </p>
        </div>

        {loading ? (
          <div className="text-xs text-slate-500">Loading...</div>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
          No audit events yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {events.map((event) => {
            const fullName =
              event.actor_full_name || event.actor_email || "System / unknown";
            const initials = event.actor_initials || "AI";

            return (
              <div
                key={event.id}
                className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3"
              >
                <div
                  title={fullName}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
                >
                  {initials}
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">
                    {event.event_label || event.event_type}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    {formatDate(event.created_at)}
                  </div>

                  {event.details ? (
                    <details className="mt-2 text-xs text-slate-600">
                      <summary className="cursor-pointer">Details</summary>
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-white p-2">
                        {JSON.stringify(event.details, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}