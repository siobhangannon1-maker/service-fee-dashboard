import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const categories = [
  "all",
  "new_referral",
  "existing_patient_correspondence",
  "radiology_review",
  "pathology_review",
  "appointment_request",
  "billing",
  "post_op",
  "clinical_question",
  "admin",
  "unknown",
];

const ruleTypes = [
  "safety",
  "workflow",
  "reply_logic",
  "tone",
  "formatting",
  "general",
];

async function createLearningRule(formData: FormData) {
  "use server";

  await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "all").trim();
  const ruleType = String(formData.get("rule_type") || "general").trim();
  const priority = Number(formData.get("priority") || 100);
  const rule = String(formData.get("rule") || "").trim();

  if (!title || !rule) {
    throw new Error("Title and rule are required.");
  }

  await supabaseAdmin.from("ai_learning_rules").insert({
    title,
    category,
    rule_type: ruleType,
    priority,
    rule,
    source: "manual",
    is_active: true,
  });

  redirect("/ai/learning-rules");
}

export default async function NewAILearningRulePage() {
  await requireRole(["super_admin"]);

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Add AI Learning Rule
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Add practice policy, reply logic, tone guidance, or safety rules.
        </p>
      </div>

      <form action={createLearningRule} className="space-y-5">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Rule title
              </span>
              <input
                name="title"
                required
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                placeholder="Always acknowledge referrals"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Category
              </span>
              <select
                name="category"
                defaultValue="all"
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
              <span className="text-sm font-medium text-slate-700">
                Rule type
              </span>
              <select
                name="rule_type"
                defaultValue="general"
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              >
                {ruleTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Priority
              </span>
              <input
                name="priority"
                type="number"
                defaultValue={100}
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              />
              <p className="mt-1 text-xs text-slate-500">
                Lower numbers are applied first. Use 10 for safety.
              </p>
            </label>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">
              Rule / logic
            </span>
            <textarea
              name="rule"
              required
              className="mt-1 min-h-56 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6 outline-none focus:border-slate-900"
              placeholder="WHEN: A new referral is received. ACTION: Always draft an acknowledgement reply. DO NOT: Promise fees, appointment availability, treatment, outcomes, or clinician review unless confirmed."
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <a
            href="/ai/learning-rules"
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </a>

          <button
            type="submit"
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Save rule
          </button>
        </div>
      </form>
    </main>
  );
}