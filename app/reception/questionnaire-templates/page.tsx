"use client";

import { useEffect, useState } from "react";

type Question = {
  id?: string;
  label: string;
  type: "yes_no" | "textarea";
  urgentOn: "yes" | "no" | "any_text" | null;
};

type QuestionnaireTemplate = {
  id: string;
  name: string;
  description: string | null;
  trigger_keywords: string[] | null;
  sms_body: string | null;
  questions: Question[];
  is_active: boolean;
};

const defaultSmsBody = `Hi {{first_name}}. We hope that you are feeling well after your procedure.

Post operative appointments are not always required, however we have a few questions to help us check your progress.

Please use the following link to complete the questionnaire:
{{questionnaire_link}}

For any urgent matters, please don't hesitate to contact our office, or your surgeon directly.

Regards,
Your Team at Focus Dental Specialists.`;

const defaultQuestions: Question[] = [
  {
    label: "Is your pain under control?",
    type: "yes_no",
    urgentOn: "no",
  },
  {
    label: "Have you experienced any significant or excessive bleeding?",
    type: "yes_no",
    urgentOn: "yes",
  },
  {
    label: "Has the feeling returned to your lips, chin, and tongue?",
    type: "yes_no",
    urgentOn: "no",
  },
  {
    label: "Have you started using mouth rinses to keep the procedure site clean?",
    type: "yes_no",
    urgentOn: null,
  },
  {
    label: "Do you require a medical certificate for time off work or study?",
    type: "yes_no",
    urgentOn: null,
  },
  {
    label: "Are there any concerns that you wish to discuss with your surgeon?",
    type: "textarea",
    urgentOn: "any_text",
  },
  {
    label:
      "Would you like to organise a post operative review? (Or has a review appointment already been made)",
    type: "yes_no",
    urgentOn: null,
  },
];

function blankForm() {
  return {
    id: "",
    name: "New questionnaire",
    description: "",
    triggerKeywords: "surgery, surgical, implant, extraction, exo, iv, sedation",
    smsBody: defaultSmsBody,
    questions: defaultQuestions,
    isActive: true,
  };
}

export default function QuestionnaireTemplatesPage() {
  const [templates, setTemplates] = useState<QuestionnaireTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");
  const [form, setForm] = useState(blankForm());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadTemplates() {
    const response = await fetch("/api/reception/questionnaire-templates");
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Could not load templates.");
      return;
    }

    setTemplates(data.templates || []);
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  function selectTemplate(id: string) {
    setSelectedId(id);

    if (id === "new") {
      setForm(blankForm());
      return;
    }

    const template = templates.find((item) => item.id === id);

    if (!template) return;

    setForm({
      id: template.id,
      name: template.name,
      description: template.description || "",
      triggerKeywords: (template.trigger_keywords || []).join(", "),
      smsBody: template.sms_body || defaultSmsBody,
      questions: template.questions || [],
      isActive: template.is_active,
    });
  }

  function updateQuestion(index: number, patch: Partial<Question>) {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question
      ),
    }));
  }

  function addQuestion() {
    setForm((current) => ({
      ...current,
      questions: [
        ...current.questions,
        {
          label: "",
          type: "yes_no",
          urgentOn: null,
        },
      ],
    }));
  }

  function removeQuestion(index: number) {
    setForm((current) => ({
      ...current,
      questions: current.questions.filter((_, questionIndex) => questionIndex !== index),
    }));
  }

  async function saveTemplate() {
    setLoading(true);
    setMessage("");

    const payload = {
      id: form.id,
      name: form.name,
      description: form.description,
      triggerKeywords: form.triggerKeywords,
      smsBody: form.smsBody,
      questions: form.questions,
      isActive: form.isActive,
    };

    const response = await fetch("/api/reception/questionnaire-templates", {
      method: form.id ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error || "Could not save template.");
      return;
    }

    setMessage("Template saved.");
    await loadTemplates();

    if (!form.id) {
      setSelectedId(data.template.id);
      setForm((current) => ({
        ...current,
        id: data.template.id,
      }));
    }
  }

  async function deleteTemplate() {
    if (!form.id) return;

    if (!confirm("Delete this questionnaire template?")) return;

    const response = await fetch(
      `/api/reception/questionnaire-templates?id=${form.id}`,
      {
        method: "DELETE",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not delete template.");
      return;
    }

    await loadTemplates();
    selectTemplate("new");
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <a
              href="/reception/messages"
              className="text-sm font-semibold text-blue-600 hover:underline"
            >
              ← Back to messages
            </a>

            <h1 className="mt-3 text-2xl font-bold text-slate-900">
              Questionnaire templates
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Create and edit post-op questionnaires and their SMS link wording.
            </p>
          </div>

          <a
            href="/reception/post-op-questionnaires"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Post-op queue
          </a>
        </div>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => selectTemplate("new")}
              className={`mb-3 w-full rounded-xl px-4 py-3 text-left text-sm font-semibold ${
                selectedId === "new"
                  ? "bg-slate-950 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              + New questionnaire
            </button>

            <div className="space-y-2">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => selectTemplate(template.id)}
                  className={`block w-full rounded-xl border p-3 text-left text-sm ${
                    selectedId === template.id
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-semibold text-slate-900">
                    {template.name}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {(template.trigger_keywords || []).join(", ") || "No triggers"}
                  </div>
                  {!template.is_active && (
                    <div className="mt-2 text-xs font-semibold text-red-600">
                      Inactive
                    </div>
                  )}
                </button>
              ))}

              {templates.length === 0 && (
                <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                  No questionnaire templates yet.
                </div>
              )}
            </div>
          </aside>

          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="grid gap-4">
              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Name
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Description
                </span>
                <input
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Appointment trigger keywords
                </span>
                <input
                  value={form.triggerKeywords}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      triggerKeywords: event.target.value,
                    }))
                  }
                  placeholder="implant, extraction, exo, iv, sedation"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-1 text-xs text-slate-500">
                  The post-op queue matches these words against appointment type,
                  label, notes, resource and provider.
                </div>
              </label>

              <label>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  SMS body
                </span>
                <textarea
                  value={form.smsBody}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      smsBody: event.target.value,
                    }))
                  }
                  className="h-56 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6"
                />
                <div className="mt-1 text-xs text-slate-500">
                  Available macros: {"{{first_name}}"} and {"{{questionnaire_link}}"}
                </div>
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">Questions</h2>
                  <button
                    type="button"
                    onClick={addQuestion}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Add question
                  </button>
                </div>

                <div className="space-y-3">
                  {form.questions.map((question, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-[1fr_150px_180px_90px]">
                        <input
                          value={question.label}
                          onChange={(event) =>
                            updateQuestion(index, {
                              label: event.target.value,
                            })
                          }
                          placeholder="Question text"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        />

                        <select
                          value={question.type}
                          onChange={(event) =>
                            updateQuestion(index, {
                              type: event.target.value as "yes_no" | "textarea",
                            })
                          }
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="yes_no">Yes / No</option>
                          <option value="textarea">Text response</option>
                        </select>

                        <select
                          value={question.urgentOn || ""}
                          onChange={(event) =>
                            updateQuestion(index, {
                              urgentOn: event.target.value
                                ? (event.target.value as Question["urgentOn"])
                                : null,
                            })
                          }
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Not urgent</option>
                          <option value="yes">Urgent if Yes</option>
                          <option value="no">Urgent if No</option>
                          <option value="any_text">Urgent if text entered</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => removeQuestion(index)}
                          className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      isActive: event.target.checked,
                    }))
                  }
                />
                Active
              </label>

              {message && <div className="text-sm text-slate-600">{message}</div>}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={loading}
                  className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save questionnaire"}
                </button>

                {form.id && (
                  <button
                    type="button"
                    onClick={deleteTemplate}
                    className="rounded-xl border border-red-200 px-5 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
