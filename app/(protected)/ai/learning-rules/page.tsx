import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Link from "next/link";

function typeBadgeClass(ruleType: string | null) {
  switch (ruleType) {
    case "automation":
      return "border-purple-200 bg-purple-50 text-purple-700";
    case "safety":
      return "border-red-200 bg-red-50 text-red-700";
    case "workflow":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function formatRuleType(ruleType: string | null) {
  return (ruleType || "general").replace(/_/g, " ");
}

export default async function AILearningRulesPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .order("is_active", { ascending: false })
    .order("rule_type", { ascending: true })
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Learning Rules</h1>

        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  const rules = data || [];
  const automationCount = rules.filter(
    (rule) => rule.rule_type === "automation" && rule.is_active,
  ).length;

  return (
    <main className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Learning Rules
          </h1>

          <p className="mt-1 text-sm text-slate-600">
            Editable practice policy, AI workflow logic, and automation safety rules.
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
              {rules.length} total rules
            </span>
            <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-purple-700">
              {automationCount} active automation rules
            </span>
          </div>
        </div>

        <Link
          href="/ai/learning-rules/new"
          className="w-fit rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Add rule
        </Link>
      </div>

      <section className="rounded-3xl border border-purple-200 bg-purple-50 p-5 text-sm text-purple-900">
        <div className="font-semibold">Automation rules now live here</div>
        <p className="mt-1 leading-6">
          To control automation preview, create rules with <strong>Rule type = automation</strong>.
          Keep risky actions as assisted or preview-only until tested.
        </p>
      </section>

      {rules.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No learning rules yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {rules.map((rule) => (
            <section
              key={rule.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-900">
                      {rule.title || "Untitled rule"}
                    </h2>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${typeBadgeClass(
                        rule.rule_type,
                      )}`}
                    >
                      {formatRuleType(rule.rule_type)}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-500">
                    Category: {rule.category || "all"} · Source: {rule.source || "manual"} · Priority: {rule.priority ?? 100}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
                  <span
                    className={
                      rule.is_active
                        ? "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                        : "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500"
                    }
                  >
                    {rule.is_active ? "Active" : "Inactive"}
                  </span>

                  <Link
                    href={`/ai/learning-rules/${rule.id}/edit`}
                    className="rounded-2xl bg-blue-600 px-3 py-2 text-xs font-medium text-white"
                  >
                    Edit
                  </Link>

                  <form action="/api/ai/learning-rules/toggle" method="POST">
                    <input type="hidden" name="id" value={rule.id} />
                    <input
                      type="hidden"
                      name="is_active"
                      value={rule.is_active ? "false" : "true"}
                    />

                    <button
                      type="submit"
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {rule.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </form>

                  <form action="/api/ai/learning-rules/delete" method="POST">
                    <input type="hidden" name="id" value={rule.id} />

                    <button
                      type="submit"
                      className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>

              <div className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {rule.rule}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
