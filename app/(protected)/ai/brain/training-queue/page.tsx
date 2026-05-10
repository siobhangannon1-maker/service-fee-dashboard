import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AITrainingQueuePage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_training_queue")
    .select("*")
    .order("status", { ascending: true })
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Training Queue</h1>
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
          AI Training Queue
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Feedback items that may deserve a new rule, template or approved example.
        </p>
      </div>

      {!data?.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No training queue items yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {data.map((item) => (
            <section key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.issue_type} · {item.category || "unknown"} · priority {item.priority ?? 100}
                  </p>
                </div>

                <span
                  className={
                    item.status === "open"
                      ? "rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
                      : "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                  }
                >
                  {item.status}
                </span>
              </div>

              {item.description ? (
                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {item.description}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/ai/learning-rules/new" className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Create rule
                </a>
                <a href="/ai/examples/new" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Create example
                </a>
                <a href="/ai/response-templates" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Create template
                </a>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
