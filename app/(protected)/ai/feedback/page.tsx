import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export default async function AIFeedbackPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_feedback")
    .select(`
      *,
      ai_inbox_items (
        file_name,
        patient_name,
        patient_dob,
        category
      ),
      ai_cases (
        title,
        category,
        risk_level,
        confidence
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Feedback</h1>
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AI Feedback
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review how receptionist-approved responses differ from the original AI drafts.
        </p>
      </div>

      {!data || data.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No AI feedback has been saved yet.
        </div>
      ) : (
        <div className="grid gap-5">
          {data.map((item) => {
            const subjectChanged =
              (item.original_subject || "").trim() !==
              (item.final_subject || "").trim();

            const bodyChanged =
              (item.original_body || "").trim() !==
              (item.final_body || "").trim();

            return (
              <section
                key={item.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-900">
                      {item.ai_cases?.title ||
                        item.ai_inbox_items?.file_name ||
                        "Feedback item"}
                    </h2>

                    <div className="mt-2 text-sm text-slate-500">
                      Patient: {item.ai_inbox_items?.patient_name || "Unknown"} ·{" "}
                      DOB: {item.ai_inbox_items?.patient_dob || "Unknown"} ·{" "}
                      Category:{" "}
                      {item.ai_inbox_items?.category ||
                        item.ai_cases?.category ||
                        "Unknown"}
                    </div>
                  </div>

                  <div className="w-fit rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                    {item.feedback_type || "feedback"}
                  </div>
                </div>

                <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase text-slate-500">
                      Risk
                    </p>
                    <p className="mt-1 text-slate-800">
                      {item.ai_cases?.risk_level || "—"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase text-slate-500">
                      Confidence
                    </p>
                    <p className="mt-1 text-slate-800">
                      {item.ai_cases?.confidence ?? "—"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase text-slate-500">
                      Changed?
                    </p>
                    <p className="mt-1 text-slate-800">
                      {subjectChanged || bodyChanged ? "Yes" : "No"}
                    </p>
                  </div>
                </div>

                {subjectChanged ? (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p className="font-medium text-amber-800">
                      Subject was changed
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase text-amber-700">
                          Original
                        </p>
                        <p className="mt-1 text-slate-700">
                          {item.original_subject || "Empty"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase text-amber-700">
                          Final
                        </p>
                        <p className="mt-1 text-slate-700">
                          {item.final_subject || "Empty"}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Original AI draft
                    </p>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {item.original_body || "No original draft body saved."}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-900">
                      Final receptionist version
                    </p>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {item.final_body || "No final body saved."}
                    </div>
                  </div>
                </div>

                {item.notes ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">Reception notes</p>
                    <p className="mt-1">{item.notes}</p>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}