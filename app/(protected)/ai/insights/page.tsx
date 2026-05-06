import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

function calculateEditRate(
  original: string | null,
  final: string | null
) {
  const a = (original || "").trim();
  const b = (final || "").trim();

  return a !== b;
}

export default async function AIInsightsPage() {
  await requireRole(["super_admin"]);

  const [
    feedbackResult,
    casesResult,
    inboxResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("ai_feedback")
      .select(`
        *,
        ai_cases (
          category,
          risk_level,
          confidence
        )
      `),

    supabaseAdmin
      .from("ai_cases")
      .select("*"),

    supabaseAdmin
      .from("ai_inbox_items")
      .select("*"),
  ]);

  const feedback = feedbackResult.data || [];
  const cases = casesResult.data || [];
  const inboxItems = inboxResult.data || [];

  const totalProcessed = feedback.length;

  const editedCount = feedback.filter((item) =>
    calculateEditRate(item.original_body, item.final_body)
  ).length;

  const unchangedCount = totalProcessed - editedCount;

  const approvalRate =
    totalProcessed > 0
      ? Math.round((unchangedCount / totalProcessed) * 100)
      : 0;

  const categoryCounts: Record<string, number> = {};
  const riskCounts: Record<string, number> = {};
  const feedbackCounts: Record<string, number> = {};

  for (const item of feedback) {
    const category =
      item.ai_cases?.category || "unknown";

    categoryCounts[category] =
      (categoryCounts[category] || 0) + 1;

    const risk =
      item.ai_cases?.risk_level || "unknown";

    riskCounts[risk] =
      (riskCounts[risk] || 0) + 1;

    const feedbackType =
      item.feedback_type || "unknown";

    feedbackCounts[feedbackType] =
      (feedbackCounts[feedbackType] || 0) + 1;
  }

  const sortedCategories = Object.entries(categoryCounts).sort(
    (a, b) => b[1] - a[1]
  );

  const sortedRisks = Object.entries(riskCounts).sort(
    (a, b) => b[1] - a[1]
  );

  const sortedFeedback = Object.entries(feedbackCounts).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <main className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AI Insights
        </h1>

        <p className="mt-1 text-sm text-slate-600">
          Practice-level insights from AI reception workflows and receptionist
          feedback.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            Processed items
          </p>

          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {totalProcessed}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            AI approval rate
          </p>

          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {approvalRate}%
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            AI cases
          </p>

          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {cases.length}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            Inbox items
          </p>

          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {inboxItems.length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Most common categories
          </h2>

          <div className="mt-4 space-y-3">
            {sortedCategories.length === 0 ? (
              <p className="text-sm text-slate-500">
                No data yet.
              </p>
            ) : (
              sortedCategories.map(([category, count]) => (
                <div
                  key={category}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <span className="text-sm text-slate-700">
                    {category}
                  </span>

                  <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                    {count}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Risk distribution
          </h2>

          <div className="mt-4 space-y-3">
            {sortedRisks.length === 0 ? (
              <p className="text-sm text-slate-500">
                No data yet.
              </p>
            ) : (
              sortedRisks.map(([risk, count]) => (
                <div
                  key={risk}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <span className="text-sm text-slate-700">
                    {risk}
                  </span>

                  <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                    {count}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Feedback types
          </h2>

          <div className="mt-4 space-y-3">
            {sortedFeedback.length === 0 ? (
              <p className="text-sm text-slate-500">
                No data yet.
              </p>
            ) : (
              sortedFeedback.map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <span className="text-sm text-slate-700">
                    {type}
                  </span>

                  <span className="rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                    {count}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          AI system observations
        </h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">
              Draft edit rate
            </p>

            <p className="mt-2 text-sm text-slate-700">
              {editedCount} of {totalProcessed} drafts were modified by reception.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">
              AI trust level
            </p>

            <p className="mt-2 text-sm text-slate-700">
              Current receptionist acceptance rate is {approvalRate}% without edits.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}