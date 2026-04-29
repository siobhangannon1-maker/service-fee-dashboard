"use client";

import { useState } from "react";

type EmailTemplate = {
  key: string;
  buttonLabel: string;
  subject: string;
  intro: string;
  checklistItems: string[];
};

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: "consumables-complete",
    buttonLabel: "Email Consumables Complete",
    subject: "Consumables Complete",
    intro: "Consumables review has been completed.",
    checklistItems: [
      "Praktika reviewed for grafting and implant codes and cross checked with current entries",
      "All consumables entries reviewed and cross checked to Praktika. Ensured that entry was correct and billing was also correct",
      "All implants reviewed to check that DDN guides have been billed",
      "DDN statement reviewed to check that guide costs are correct",
    ],
  },
  {
    key: "end-of-month-complete",
    buttonLabel: "Email End of Month Complete",
    subject: "End of Month Complete",
    intro: "End of month review has been completed.",
    checklistItems: ["Praktika reviewed for $0 appointments",
      "Praktika reviewed for $0 item codes",
      "Praktika reviewed for incomplete appointments",
      "All incorrect payments entries reviewed for correctness",
      "Focus Tyro portal reviewed to identify any payments into the Focus account",
      "Check that no Xestro payments have been received into the Focus account",
      "Humm merchant fees entered into portal (surgical fee - (Humm remittance/1.1)",
      "Humm surgeon fee entered as a payment to Focus",
      "Review debtors, deposits and refunds",
    ],
  },
];

export default function CompletionEmailButtons() {
  const [selectedTemplate, setSelectedTemplate] =
    useState<EmailTemplate | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [intro, setIntro] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error" | "default">("default");

  function openTemplate(template: EmailTemplate) {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setIntro(template.intro);
    setChecklistText(template.checklistItems.join("\n"));
    setMessage("");
    setTone("default");
  }

  function closeModal() {
    if (sending) return;

    setSelectedTemplate(null);
    setTo("");
    setSubject("");
    setIntro("");
    setChecklistText("");
    setMessage("");
    setTone("default");
  }

  async function sendEmail() {
    setSending(true);
    setMessage("");

    const checklistItems = checklistText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const response = await fetch("/api/send-completion-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          subject,
          intro,
          checklistItems,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Email failed to send.");
      }

      setTone("success");
      setMessage("Email sent successfully.");
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error ? error.message : "Email failed to send."
      );
    } finally {
      setSending(false);
    }
  }

  const previewChecklistItems = checklistText
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <>
      <div className="mt-4 rounded-3xl border bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-semibold text-slate-900">
          Completion emails
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Send a completion email to any email address. You can edit the email
          and checklist before sending.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {EMAIL_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => openTemplate(template)}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white sm:w-auto"
            >
              {template.buttonLabel}
            </button>
          ))}
        </div>
      </div>

      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-4 shadow-xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {selectedTemplate.buttonLabel}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Edit the email details before sending.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={sending}
                className="rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Close
              </button>
            </div>

            {message && (
              <div
                className={`mt-4 rounded-2xl border p-3 text-sm ${
                  tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : tone === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {message}
              </div>
            )}

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Send to email address
                </label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-2xl border px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-2xl border px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Email message
                </label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border px-3 py-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Checklist
                </label>
                <p className="mb-2 text-xs text-slate-500">
                  Put each checklist item on a new line.
                </p>
                <textarea
                  value={checklistText}
                  onChange={(e) => setChecklistText(e.target.value)}
                  rows={8}
                  placeholder="Add checklist items here, one per line"
                  className="w-full rounded-2xl border px-3 py-3 text-sm"
                />
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Preview
                </h3>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  {subject || "No subject"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {intro}
                </p>

                {previewChecklistItems.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {previewChecklistItems.map((item, index) => (
                      <li key={`${item}-${index}`}>
                        <span className="mr-2">☐</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={sending}
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
                >
                  {sending ? "Sending..." : "Send email"}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={sending}
                  className="inline-flex w-full items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium disabled:opacity-50 sm:w-auto"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}