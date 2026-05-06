import DeleteExampleButton from "@/components/ai/DeleteExampleButton";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function AIExamplesPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_approved_examples")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Approved Examples</h1>
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
          AI Approved Examples
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Past high-quality replies that the AI can learn from when drafting.
        </p>
      </div>

      <a
        href="/ai/examples/new"
        className="inline-flex rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Add approved example
      </a>

      {!data || data.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No approved examples yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {data.map((example) => (
            <section
              key={example.id}
              className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {example.title || "Untitled example"}
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Category: {example.category || "all"} · Source:{" "}
                    {example.source || "manual"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    Active
                  </span>

                  <DeleteExampleButton id={example.id} />
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm font-medium text-slate-900">
                    Incoming message
                  </p>
                  <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {example.incoming_message}
                  </div>
                </div>

                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-sm font-medium text-emerald-900">
                    Approved reply
                  </p>

                  {example.approved_reply_subject ? (
                    <p className="mt-2 text-sm font-medium text-slate-800">
                      Subject: {example.approved_reply_subject}
                    </p>
                  ) : null}

                  <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {example.approved_reply_body}
                  </div>
                </div>
              </div>

              {example.tone_notes || example.avoid_notes ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {example.tone_notes ? (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                      <p className="font-medium">Tone notes</p>
                      <p className="mt-1">{example.tone_notes}</p>
                    </div>
                  ) : null}

                  {example.avoid_notes ? (
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-medium">Avoid notes</p>
                      <p className="mt-1">{example.avoid_notes}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}