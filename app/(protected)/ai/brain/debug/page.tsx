import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AIBrainDebugPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_brain_debug_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Brain Debug</h1>
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
          AI Brain Debug
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Prompt previews, memory context and parsed AI responses.
        </p>
      </div>

      {!data?.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No debug logs yet.
        </div>
      ) : (
        <div className="grid gap-5">
          {data.map((log) => (
            <section key={log.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {log.event_type || "debug log"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Model: {log.model || "unknown"} ·{" "}
                    {log.created_at ? new Date(log.created_at).toLocaleString("en-AU") : "Unknown date"}
                  </p>
                </div>

                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                  {log.inbox_item_id || "no inbox id"}
                </span>
              </div>

              <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-900">
                  Prompt Preview
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                  {log.prompt_preview || "No prompt saved."}
                </pre>
              </details>

              <details className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-blue-900">
                  Memory Context
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-blue-900">
                  {JSON.stringify(log.memory_context || {}, null, 2)}
                </pre>
              </details>

              <details className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <summary className="cursor-pointer text-sm font-medium text-emerald-900">
                  Parsed Response
                </summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-emerald-900">
                  {JSON.stringify(log.parsed_response || {}, null, 2)}
                </pre>
              </details>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
