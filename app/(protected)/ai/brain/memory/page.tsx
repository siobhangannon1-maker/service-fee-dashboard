import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function AIBrainMemoryPage() {
  await requireRole(["super_admin"]);

  const [rulesResult, templatesResult, examplesResult] =
    await Promise.all([
      supabaseAdmin
        .from("ai_learning_rules")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: true })
        .limit(20),

      supabaseAdmin
        .from("ai_response_templates")
        .select("*")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(20),

      supabaseAdmin
        .from("ai_approved_examples")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const rules = rulesResult.data || [];
  const templates = templatesResult.data || [];
  const examples = examplesResult.data || [];

  return (
    <main className="space-y-8 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          AI Memory System
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Structured operational memory used by the AI receptionist brain.
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">
          Active Learning Rules
        </h2>

        <div className="mt-6 grid gap-4">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                  Priority {rule.priority ?? 100}
                </span>

                <span className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700">
                  {rule.rule_type || "general"}
                </span>

                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
                  {rule.category || "all"}
                </span>
              </div>

              <h3 className="mt-4 font-semibold text-slate-900">
                {rule.title || "Untitled rule"}
              </h3>

              <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {rule.rule}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">
          Response Templates
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {templates.map((template) => (
            <div
              key={template.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
            >
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                  {template.category || "all"}
                </span>
              </div>

              <h3 className="mt-4 font-semibold text-slate-900">
                {template.title || "Untitled template"}
              </h3>

              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    Subject Template
                  </p>

                  <div className="mt-1 whitespace-pre-wrap text-slate-700">
                    {template.subject_template || "No subject template"}
                  </div>
                </div>

                <div>
                  <p className="font-medium text-slate-900">
                    Body Template
                  </p>

                  <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-slate-700">
                    {template.body_template || "No body template"}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">
          Approved Examples
        </h2>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {examples.map((example) => (
            <div
              key={example.id}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
            >
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
                  {example.category || "all"}
                </span>
              </div>

              <h3 className="mt-4 font-semibold text-slate-900">
                {example.title || "Untitled example"}
              </h3>

              <div className="mt-4 grid gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Incoming message
                  </p>

                  <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {example.incoming_message}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Approved reply
                  </p>

                  <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {example.approved_reply_body}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}