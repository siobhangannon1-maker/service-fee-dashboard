"use client";

import { useState } from "react";

type ResponseTemplate = {
  id: string;
  created_at: string;
  updated_at: string | null;
  category: string;
  title: string;
  subject_template: string | null;
  body_template: string;
  tone_notes: string | null;
  avoid_notes: string | null;
  is_active: boolean | null;
};

type DraftTemplate = {
  category: string;
  title: string;
  subject_template: string;
  body_template: string;
  tone_notes: string;
  avoid_notes: string;
};

const emptyTemplate: DraftTemplate = {
  category: "referral_received",
  title: "",
  subject_template: "",
  body_template: "",
  tone_notes: "",
  avoid_notes: "",
};

const categories = [
  "referral_received",
  "existing_patient_correspondence_received",
  "invoice_request",
  "medical_certificate_request",
  "reschedule_request",
  "quote_enquiry",
  "appointment_availability",
  "procedure_question",
  "post_op_concern",
  "missing_referral_information",
];

export default function ResponseTemplatesClient({
  initialTemplates,
}: {
  initialTemplates: ResponseTemplate[];
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState<DraftTemplate>(emptyTemplate);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");

  async function loadTemplates() {
    const response = await fetch("/api/ai-reception/response-templates", {
      cache: "no-store",
    });

    const result = await response.json();

    if (response.ok) {
      setTemplates(result.templates || []);
    }
  }

  async function saveTemplate() {
    setSaving(true);
    setMessage("");

    const response = await fetch("/api/ai-reception/response-templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draft),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to save template.");
      setSaving(false);
      return;
    }

    setMessage("Template saved.");
    setDraft(emptyTemplate);
    await loadTemplates();
    setSaving(false);
  }

  async function generateStarterTemplates() {
  setGenerating(true);
  setMessage("");

  try {
    const response = await fetch(
      "/api/ai-reception/response-templates/generate-starters",
      {
        method: "POST",
      }
    );

    const rawText = await response.text();

    let result: any = {};
    try {
      result = rawText ? JSON.parse(rawText) : {};
    } catch {
      setMessage(
        `The server returned a non-JSON response. Status: ${response.status}. Response: ${rawText.slice(
          0,
          300
        )}`
      );
      setGenerating(false);
      return;
    }

    if (!response.ok) {
      setMessage(result.error || "Failed to generate starter templates.");
      setGenerating(false);
      return;
    }

    setMessage(`Generated ${result.count || 0} starter templates.`);
    await loadTemplates();
  } catch (err) {
    setMessage(
      err instanceof Error
        ? err.message
        : "Failed to generate starter templates."
    );
  } finally {
    setGenerating(false);
  }
}

  async function toggleTemplate(template: ResponseTemplate) {
    const response = await fetch("/api/ai-reception/response-templates/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: template.id,
        is_active: !template.is_active,
      }),
    });

    if (response.ok) {
      await loadTemplates();
    }
  }

  return (
    <main className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Response Templates
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Approved practice wording that AI will use when drafting replies.
          </p>
        </div>

        <button
          type="button"
          onClick={generateStarterTemplates}
          disabled={generating}
          className="rounded-2xl bg-blue-700 px-4 py-3 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {generating ? "Generating..." : "Generate starter templates"}
        </button>
      </div>

      {message ? (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      ) : null}

      <section className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Add template manually
        </h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Category
            </span>
            <select
              value={draft.category}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  category: e.target.value,
                }))
              }
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Title</span>
            <input
              value={draft.title}
              onChange={(e) =>
                setDraft((current) => ({ ...current, title: e.target.value }))
              }
              className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Referral received acknowledgement"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">
            Subject template
          </span>
          <input
            value={draft.subject_template}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                subject_template: e.target.value,
              }))
            }
            className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
            placeholder="Referral received – Focus Dental Specialists"
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">
            Body template
          </span>
          <textarea
            value={draft.body_template}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                body_template: e.target.value,
              }))
            }
            className="mt-1 min-h-48 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
            placeholder="Dear [Name], ..."
          />
        </label>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Tone notes
            </span>
            <textarea
              value={draft.tone_notes}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  tone_notes: e.target.value,
                }))
              }
              className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Warm, concise, professional..."
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Avoid notes
            </span>
            <textarea
              value={draft.avoid_notes}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  avoid_notes: e.target.value,
                }))
              }
              className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              placeholder="Do not provide clinical advice or quote exact fees..."
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={saveTemplate}
            disabled={saving || !draft.title || !draft.body_template}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save template"}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Saved templates
        </h2>

        {templates.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            No templates yet. Click “Generate starter templates”.
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {template.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {template.category} ·{" "}
                      {template.is_active ? "Active" : "Inactive"}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleTemplate(template)}
                    className="w-fit rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {template.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>

                {template.subject_template ? (
                  <div className="mt-3 text-sm text-slate-700">
                    <span className="font-medium">Subject:</span>{" "}
                    {template.subject_template}
                  </div>
                ) : null}

                <div className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  {template.body_template}
                </div>

                {template.tone_notes ? (
                  <div className="mt-3 text-xs text-slate-500">
                    <span className="font-medium">Tone:</span>{" "}
                    {template.tone_notes}
                  </div>
                ) : null}

                {template.avoid_notes ? (
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">Avoid:</span>{" "}
                    {template.avoid_notes}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}