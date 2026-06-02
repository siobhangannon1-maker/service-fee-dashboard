"use client";

import { useEffect, useState } from "react";

type Question = {
  id: string;
  label: string;
  type: "yes_no" | "textarea";
};

export default function PublicQuestionnairePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [queueItem, setQueueItem] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function resolveParams() {
      const resolved = await params;
      setToken(resolved.token);
    }

    resolveParams();
  }, [params]);

  useEffect(() => {
    if (!token) return;

    async function loadQuestionnaire() {
      setLoading(true);
      const response = await fetch(`/api/questionnaire/${token}`);
      const data = await response.json();
      setLoading(false);

      if (!response.ok) {
        setError(data.error || "Questionnaire not found.");
        return;
      }

      setQueueItem(data.queueItem);
      setTemplate(data.template);
    }

    loadQuestionnaire();
  }, [token]);

  async function submit() {
    setSubmitting(true);
    setError("");

    const response = await fetch(`/api/questionnaire/${token}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answers }),
    });

    const data = await response.json();
    setSubmitting(false);

    if (!response.ok) {
      setError(data.error || "Could not submit questionnaire.");
      return;
    }

    setSubmitted(true);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          Loading...
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">
            Focus Dental Specialists
          </h1>
          <p className="mt-4 text-red-600">{error}</p>
        </div>
      </main>
    );
  }

  if (submitted || queueItem?.status === "completed") {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">
            Thank you
          </h1>
          <p className="mt-4 text-slate-600">
            Your questionnaire has been submitted. Our team will review your
            responses.
          </p>
          <p className="mt-4 text-sm text-slate-500">
            For urgent matters, please contact our office or your surgeon
            directly.
          </p>
        </div>
      </main>
    );
  }

  const questions: Question[] = template?.questions || [];

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold text-slate-900">
          Focus Dental Specialists
        </h1>

        <p className="mt-3 text-slate-600">
          Please complete the following post-operative questionnaire.
        </p>

        <div className="mt-8 divide-y divide-slate-200">
          {questions.map((question) => (
            <div key={question.id} className="py-5">
              <label className="block text-lg font-semibold text-slate-900">
                {question.label}
              </label>

              {question.type === "yes_no" ? (
                <div className="mt-3 flex gap-3">
                  {["yes", "no"].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: value,
                        }))
                      }
                      className={`rounded-xl border px-5 py-2 text-sm font-semibold ${
                        answers[question.id] === value
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-300 bg-white text-slate-700"
                      }`}
                    >
                      {value === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  value={answers[question.id] || ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  className="mt-3 h-28 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Type your response..."
                />
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-6 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>

        <p className="mt-6 text-sm text-slate-500">
          For urgent matters, please don't hesitate to contact our office, or
          your surgeon directly.
        </p>
      </div>
    </main>
  );
}
