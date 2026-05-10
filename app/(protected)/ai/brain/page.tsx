import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function AIBrainPage() {
  const [
    casesResult,
    rulesResult,
    templatesResult,
    examplesResult,
    feedbackResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("ai_cases")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),

    supabaseAdmin
      .from("ai_learning_rules")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("ai_response_templates")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("ai_approved_examples")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("ai_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const cases = casesResult.data || [];

  const rulesCount = rulesResult.count || 0;
  const templatesCount = templatesResult.count || 0;
  const examplesCount = examplesResult.count || 0;

  const feedback = feedbackResult.data || [];

  const approvedWithoutChanges = feedback.filter(
    (f) => f.feedback_type === "approved_without_changes"
  ).length;

  const approvalRate =
    feedback.length > 0
      ? Math.round(
          (approvedWithoutChanges / feedback.length) * 100
        )
      : 0;

  if (casesResult.error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">AI Brain</h1>

        <p className="text-red-600">
          {casesResult.error.message}
        </p>
      </div>
    );
  }

  return (
    <main className="space-y-8 p-6">
      {/* -------------------------------- */}
      {/* HEADER */}
      {/* -------------------------------- */}

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          AI Brain
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Case-level AI decisions, risks, confidence,
          learning systems and operational intelligence.
        </p>
      </div>

      {/* -------------------------------- */}
      {/* LEARNING OVERVIEW */}
      {/* -------------------------------- */}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Learning Rules"
          value={String(rulesCount)}
          subtitle="Operational AI instructions"
        />

        <StatCard
          title="Templates"
          value={String(templatesCount)}
          subtitle="Reusable reply structures"
        />

        <StatCard
          title="Approved Examples"
          value={String(examplesCount)}
          subtitle="High-quality learned replies"
        />

        <StatCard
          title="Approval Rate"
          value={`${approvalRate}%`}
          subtitle="Approved without edits"
        />
      </section>

      {/* -------------------------------- */}
      {/* MEMORY NAVIGATION */}
      {/* -------------------------------- */}

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">
          AI Memory & Learning
        </h2>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <NavCard
            href="/ai/learning-rules"
            title="Learning Rules"
            description="Operational AI behaviour and workflow rules."
          />

          <NavCard
            href="/ai/examples"
            title="Approved Examples"
            description="Successful receptionist-reviewed replies."
          />

          <NavCard
            href="/ai/response-templates"
            title="Response Templates"
            description="Reusable structured response templates."
          />

          <NavCard
            href="/ai/feedback"
            title="AI Feedback"
            description="Reception edits and AI learning feedback."
          />

          <NavCard
            href="/ai/insights"
            title="AI Insights"
            description="Analytics, approval rate and trends."
          />

          <NavCard
            href="/ai/workbench"
            title="AI Workbench"
            description="Inbox review and AI operations."
          />
        </div>
      </section>

      {/* -------------------------------- */}
      {/* RECENT FEEDBACK */}
      {/* -------------------------------- */}

      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Recent AI Feedback
          </h2>

          <Link
            href="/ai/feedback"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            View all
          </Link>
        </div>

        <div className="mt-5 space-y-3">
          {feedback.slice(0, 10).map((item) => (
            <div
              key={item.id}
              className="rounded-xl border bg-slate-50 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">
                    {item.feedback_type || "feedback"}
                  </p>

                  <p className="text-sm text-muted-foreground">
                    {item.notes || "No notes"}
                  </p>
                </div>

                <div className="text-right text-xs text-muted-foreground">
                  {item.created_at
                    ? new Date(item.created_at).toLocaleDateString()
                    : "Unknown"}
                </div>
              </div>
            </div>
          ))}

          {!feedback.length && (
            <p className="text-sm text-muted-foreground">
              No AI feedback yet.
            </p>
          )}
        </div>
      </section>

      {/* -------------------------------- */}
      {/* AI CASES */}
      {/* -------------------------------- */}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">
            AI Cases
          </h2>

          <p className="text-sm text-muted-foreground">
            AI-generated operational case analysis.
          </p>
        </div>

        <div className="grid gap-4">
          {cases.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">
                    {item.title || "Untitled case"}
                  </h2>

                  <p className="text-sm text-muted-foreground">
                    {item.patient_name || "No patient name"}{" "}
                    {item.patient_dob
                      ? `• DOB: ${item.patient_dob}`
                      : ""}
                  </p>
                </div>

                <div className="text-right text-sm">
                  <p>
                    Category: {item.category || "unknown"}
                  </p>

                  <p>
                    Confidence: {item.confidence ?? "—"}
                  </p>

                  <p>
                    Risk: {item.risk_level || "unknown"}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
                <p className="font-medium">
                  Recommended next step
                </p>

                <p>
                  {item.recommended_next_step ||
                    "No recommendation"}
                </p>
              </div>
            </div>
          ))}

          {!cases.length && (
            <p className="text-sm text-muted-foreground">
              No AI Brain cases yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">
        {title}
      </p>

      <p className="mt-3 text-4xl font-semibold tracking-tight">
        {value}
      </p>

      <p className="mt-2 text-sm text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border bg-slate-50 p-4 transition hover:bg-white"
    >
      <p className="font-medium">
        {title}
      </p>

      <p className="mt-1 text-sm text-muted-foreground">
        {description}
      </p>
    </Link>
  );
}