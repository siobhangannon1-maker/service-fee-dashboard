import { notFound, redirect } from "next/navigation";

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

async function updateRule(formData: FormData) {
  "use server";

  await requireRole(["super_admin"]);

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "all").trim();
  const ruleType = String(formData.get("rule_type") || "general").trim();
  const priority = Number(formData.get("priority") || 100);
  const rule = String(formData.get("rule") || "").trim();

  if (!id || !title || !rule) {
    throw new Error("Missing required fields.");
  }

  const { error } = await supabaseAdmin
    .from("ai_learning_rules")
    .update({
      title,
      category,
      rule_type: ruleType,
      priority,
      rule,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }

  redirect("/ai/learning-rules");
}

export default async function EditLearningRulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["super_admin"]);

  const { id } = await params;

  const { data: rule, error } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !rule) {
    notFound();
  }

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Edit AI Learning Rule
        </h1>

        <p className="mt-1 text-sm text-slate-600">
          Update practice policy, AI workflow logic, and automation safety rules.
        </p>
      </div>

      <section className="rounded-3xl border border-purple-200 bg-purple-50 p-5 text-sm text-purple-900">
        <div className="font-semibold">Automation rule tip</div>
        <p className="mt-1 leading-6">
          For automation preview and execution, choose{" "}
          <strong>Rule type = automation</strong>. Use categories like{" "}
          <strong>praktika_filing</strong>, <strong>archive</strong>,{" "}
          <strong>outlook</strong>, <strong>sms</strong>, or{" "}
          <strong>patient_creation</strong>.
        </p>
      </section>

      <form action={updateRule} className="space-y-5">
        <input type="hidden" name="id" value={rule.id} />

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Rule title
              </span>

              <input
                name="title"
                required
                defaultValue={rule.title || ""}
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                Category
              </span>

              <select
                name="category"
                defaultValue={rule.category || "all"}
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
                defaultValue={rule.rule_type || "general"}
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
                defaultValue={rule.priority || 100}
                className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
              />

              <p className="mt-1 text-xs text-slate-500">
                Lower numbers are applied first. Use 10–30 for automation/safety.
              </p>
            </label>
          </div>

          <label className="mt-5 block">
            <span className="text-sm font-medium text-slate-700">
              Rule
            </span>

            <textarea
              name="rule"
              required
              defaultValue={rule.rule || ""}
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
            Save changes
          </button>
        </div>
      </form>
    </main>
  );
}