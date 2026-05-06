"use client";

import { useEffect, useState } from "react";

type AuditEvent = {
  id: string;
  inbox_item_id: string | null;
  case_id: string | null;
  draft_id: string | null;
  actor_id: string | null;
  event_type: string;
  event_summary: string | null;
  previous_values: any;
  new_values: any;
  metadata: any;
  created_at: string | null;
};

function formatEventType(eventType: string) {
  return eventType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "Unknown time";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getEventBadgeClasses(eventType: string) {
  if (eventType.includes("sent")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (eventType.includes("draft")) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (eventType.includes("archive")) {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }

  if (eventType.includes("clinical")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (eventType.includes("no_match")) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-purple-200 bg-purple-50 text-purple-700";
}

export default function AuditTrailPanel({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadEvents() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/audit-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load audit trail.");
        return;
      }

      setEvents(result.events || []);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load audit trail."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (inboxItemId) {
      loadEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxItemId]);

  return (
    <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Audit trail</h3>
          <p className="mt-1 text-xs text-slate-500">
            Tracks important workbench actions for this item.
          </p>
        </div>

        <button
          type="button"
          onClick={loadEvents}
          disabled={loading}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {message ? (
        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          {message}
        </div>
      ) : null}

      {events.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          No audit events found yet.
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${getEventBadgeClasses(
                      event.event_type
                    )}`}
                  >
                    {formatEventType(event.event_type)}
                  </span>

                  <p className="mt-2 text-sm font-medium text-slate-900">
                    {event.event_summary || "Workbench action recorded."}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(event.created_at)}
                  </p>
                </div>
              </div>

              {event.actor_id ? (
                <p className="mt-2 text-xs text-slate-500">
                  Actor ID: {event.actor_id}
                </p>
              ) : null}

              {event.new_values &&
              typeof event.new_values === "object" &&
              Object.keys(event.new_values).length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-slate-600">
                    View details
                  </summary>

                  <pre className="mt-2 max-h-48 overflow-auto rounded-2xl bg-white p-3 text-xs text-slate-700">
                    {JSON.stringify(event.new_values, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}