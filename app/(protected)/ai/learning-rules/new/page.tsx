import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const categories = [
  "all",
  "automation",
  "praktika_filing",
  "archive",
  "outlook",
  "sms",
  "patient_creation",
  "new_referral",
  "classification",
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
  "automation",
  "safety",
  "workflow",
  "reply_logic",
  "tone",
  "formatting",
  "general",
];

const automationTemplate = `WHEN: An inbox item has one exact Praktika patient match with 100% confidence, no duplicate candidates, attachments are present, OCR is complete, and no clinical review is required.
ACTION: Automatically allow filing attachments to Praktika.
MODE: automatic
DO NOT: Auto-file if there are duplicate candidates, possible matches, missing OCR, no patient match, or clinical review is required.`;

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
          Add practice policy, reply logic, tone guidance, safety rules, or automation preview rules.
        </p>
      </div>

      <section className="rounded-3xl border border-purple-200 bg-purple-50 p-5 text-sm text-purple-900">
        <div className="font-semibold">Automation rule tip</div>
        <p className="mt-1 leading-6">
          For automation preview, choose <strong>Rule type = automation</strong>. Use words like
          Praktika filing, Trello, Outlook draft, send Outlook, archive, Chekkit, SMS, or create new patient
          so the preview engine can match the rule to the right action.
        </p>
      </section>

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
                placeholder="Auto-file exact Praktika matches"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Category
              </span>
              <select
                name="category"
                defaultValue="praktika_filing"
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
                defaultValue="automation"
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
                defaultValue={20}
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              />
              <p className="mt-1 text-xs text-slate-500">
                Lower numbers are applied first. Use 10–30 for automation/safety.
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
              defaultValue={automationTemplate}
              className="mt-1 min-h-64 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6 outline-none focus:border-slate-900"
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
