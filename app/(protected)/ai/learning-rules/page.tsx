import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function AILearningRulesPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
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

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AI Learning Rules
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Practice-specific rules that future AI drafts should follow.
        </p>
      </div>

      <a
        href="/ai/learning-rules/new"
        className="inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Add learning rule
      </a>

      {!data || data.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No learning rules yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {data.map((rule) => (
            <section
              key={rule.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {rule.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Category: {rule.category || "all"} · Source:{" "}
                    {rule.source || "manual"}
                  </p>
                </div>

                <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                  {rule.is_active ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                {rule.rule}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}