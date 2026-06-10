"use client";

import { useEffect, useState } from "react";

const appointmentTypes = [
  { value: "all", label: "All Appointment Types" },
  { value: "periodontal_consultation", label: "Periodontal Consultation" },
  { value: "periodontal_review", label: "Periodontal Review" },
  { value: "supportive_periodontal_therapy", label: "Supportive Periodontal Therapy" },
  { value: "implant_consultation", label: "Implant Consultation" },
  { value: "oral_surgery_consultation", label: "Oral Surgery Consultation" },
  { value: "post_op_review", label: "Post-operative Review" },
];

type UniversalRule = {
  id: string;
  appointment_type: string;
  rule_text: string;
  created_at: string;
};

export default function UniversalClinicalScribeRulesClient() {
  const [rules, setRules] = useState<UniversalRule[]>([]);
  const [appointmentType, setAppointmentType] = useState("all");
  const [ruleText, setRuleText] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadRules() {
    const response = await fetch("/api/clinical-scribe/universal-rules");
    const data = await response.json();

    if (data.success) {
      setRules(data.rules || []);
    }
  }

  useEffect(() => {
    loadRules();
  }, []);

  async function addRule() {
    if (!ruleText.trim()) {
      alert("Enter a rule first.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/clinical-scribe/universal-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appointmentType,
          ruleText,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to save universal rule.");
        return;
      }

      setRuleText("");
      setAppointmentType("all");
      await loadRules();
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(ruleId: string) {
    const confirmed = confirm("Delete this universal rule?");

    if (!confirmed) return;

    const response = await fetch("/api/clinical-scribe/universal-rules/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ruleId }),
    });

    const data = await response.json();

    if (!data.success) {
      alert(data.error || "Failed to delete universal rule.");
      return;
    }

    await loadRules();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Universal Clinical Scribe Rules</h1>
        <p className="mt-2 text-slate-600">
          These rules apply to all providers unless provider-specific rules add
          extra instructions.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-bold">Add Universal Rule</h2>

        <select
          className="w-full rounded-xl border p-3"
          value={appointmentType}
          onChange={(e) => setAppointmentType(e.target.value)}
        >
          {appointmentTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>

        <textarea
          className="h-36 w-full rounded-xl border p-3"
          placeholder="Example: Do not invent clinical findings. Only document treatment plans discussed during the consultation. Use Australian English and FDI tooth numbering."
          value={ruleText}
          onChange={(e) => setRuleText(e.target.value)}
        />

        <button
          onClick={addRule}
          disabled={loading}
          className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          Add Universal Rule
        </button>
      </section>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-bold">Saved Universal Rules</h2>

        <div className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              No universal clinical scribe rules saved yet.
            </div>
          ) : null}

          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">
                {rule.appointment_type}
              </div>

              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {rule.rule_text}
              </div>

              <button
                onClick={() => deleteRule(rule.id)}
                className="mt-3 text-sm font-semibold text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}