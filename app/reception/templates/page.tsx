"use client";

import { useEffect, useState } from "react";

type Template = {
  id: string;
  name: string;
  category: string | null;
  body: string;
};

export default function ReceptionTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadTemplates() {
    const response = await fetch("/api/reception/templates");
    const data = await response.json();

    setTemplates(data.templates || []);
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  async function saveTemplate() {
    if (!name.trim() || !body.trim()) {
      alert("Template name and message body are required.");
      return;
    }

    setSaving(true);

    const response = await fetch("/api/reception/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        category,
        body,
      }),
    });

    const data = await response.json();

    setSaving(false);

    if (!response.ok) {
      alert(data.error || "Could not save template.");
      return;
    }

    setName("");
    setCategory("");
    setBody("");
    await loadTemplates();
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Reception Templates
            </h1>
            <p className="text-sm text-slate-500">
              Create reusable SMS templates with optional Praktika macros.
            </p>
          </div>

          <a
            href="/reception/messages"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to messages
          </a>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Add template
            </h2>

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Template name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Appointment change"
              className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Category
            </label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Appointments, Post-op, Admin..."
              className="mb-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi {{preferred_name}}, just confirming your appointment on {{next_appointment_date}} at {{next_appointment_time}}."
              className="h-56 w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
              <div className="font-semibold text-slate-700">
                Supported macros
              </div>
              <div>{"{{first_name}}"}</div>
              <div>{"{{preferred_name}}"}</div>
              <div>{"{{last_name}}"}</div>
              <div>{"{{patient_number}}"}</div>
              <div>{"{{next_appointment_date}}"}</div>
              <div>{"{{next_appointment_time}}"}</div>
              <div>{"{{next_appointment_day}}"}</div>
              <div>{"{{next_appointment_type}}"}</div>
              <div>{"{{location}}"}</div>
            </div>

            <button
              onClick={saveTemplate}
              disabled={saving}
              className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save template"}
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">
              Existing templates
            </h2>

            <div className="space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {template.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {template.category || "No category"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                    {template.body}
                  </div>
                </div>
              ))}

              {templates.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
                  No templates yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}