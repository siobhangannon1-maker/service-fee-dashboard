"use client";

import { useEffect, useState } from "react";

type Rule = {
  id: string;
  priority: number;
  match_field: string;
  match_type: string;
  match_value: string;
  location_name: string;
  is_active: boolean;
};

const fields = [
  { value: "tx_type", label: "Appointment type" },
  { value: "tx_label", label: "Appointment label" },
  { value: "appointment_notes", label: "Appointment notes" },
  { value: "resource_name", label: "Resource name" },
  { value: "provider_name", label: "Provider name" },
];

const matchTypes = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "starts_with", label: "Starts with" },
];

export default function LocationRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [priority, setPriority] = useState(10);
  const [matchField, setMatchField] = useState("tx_type");
  const [matchType, setMatchType] = useState("contains");
  const [matchValue, setMatchValue] = useState("");
  const [locationName, setLocationName] = useState("Focus Dental Specialists");

  async function loadRules() {
    const response = await fetch("/api/reception/location-rules");
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Could not load rules.");
      return;
    }

    setRules(data.rules || []);
  }

  useEffect(() => {
    loadRules();
  }, []);

  async function createRule() {
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/reception/location-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        priority,
        matchField,
        matchType,
        matchValue,
        locationName,
        isActive: true,
      }),
    });

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error || "Could not create rule.");
      return;
    }

    setMatchValue("");
    await loadRules();
    setMessage("Rule added. Re-sync appointments to apply changes.");
  }

  async function updateRule(id: string, payload: any) {
    const response = await fetch("/api/reception/location-rules", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
        ...payload,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not update rule.");
      return;
    }

    await loadRules();
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this rule?")) return;

    const response = await fetch(`/api/reception/location-rules?id=${id}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not delete rule.");
      return;
    }

    await loadRules();
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <a
            href="/reception/messages"
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            ← Back to messages
          </a>

          <h1 className="mt-3 text-2xl font-bold text-slate-900">
            Appointment location mapping
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Match Praktika appointment types, labels, notes, resources, or
            providers to the correct appointment location.
          </p>
        </div>

        <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Add mapping rule
          </h2>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Priority
              </label>
              <input
                type="number"
                value={priority}
                onChange={(event) => setPriority(Number(event.target.value))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Field
              </label>
              <select
                value={matchField}
                onChange={(event) => setMatchField(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {fields.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Match
              </label>
              <select
                value={matchType}
                onChange={(event) => setMatchType(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {matchTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Value
              </label>
              <input
                value={matchValue}
                onChange={(event) => setMatchValue(event.target.value)}
                placeholder="e.g. GPH"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Location
              </label>
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="e.g. Greenslopes Private Hospital"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <button
            onClick={createRule}
            disabled={loading || !matchValue.trim() || !locationName.trim()}
            className="mt-4 rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {loading ? "Adding..." : "Add rule"}
          </button>

          {message && <p className="mt-3 text-sm text-slate-500">{message}</p>}
        </section>

        <section className="rounded-2xl bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Current rules
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Lower priority numbers run first.
            </p>
          </div>

          <div className="divide-y">
            {rules.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                No mapping rules yet.
              </div>
            )}

            {rules.map((rule) => (
              <div
                key={rule.id}
                className={`grid gap-3 p-4 md:grid-cols-[80px_1fr_1fr_1fr_1fr_100px] ${
                  !rule.is_active ? "opacity-50" : ""
                }`}
              >
                <input
                  type="number"
                  value={rule.priority}
                  onChange={(event) =>
                    updateRule(rule.id, {
                      priority: Number(event.target.value),
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />

                <select
                  value={rule.match_field}
                  onChange={(event) =>
                    updateRule(rule.id, {
                      matchField: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {fields.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>

                <select
                  value={rule.match_type}
                  onChange={(event) =>
                    updateRule(rule.id, {
                      matchType: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  {matchTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>

                <input
                  value={rule.match_value}
                  onChange={(event) =>
                    updateRule(rule.id, {
                      matchValue: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />

                <input
                  value={rule.location_name}
                  onChange={(event) =>
                    updateRule(rule.id, {
                      locationName: event.target.value,
                    })
                  }
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      updateRule(rule.id, {
                        isActive: !rule.is_active,
                      })
                    }
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  >
                    {rule.is_active ? "On" : "Off"}
                  </button>

                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}