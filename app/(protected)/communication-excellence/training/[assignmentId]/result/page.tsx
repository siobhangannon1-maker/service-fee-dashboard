import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ assignmentId: string }>;
};

type TrainingModuleRelation =
  | {
      title: string;
      passing_score: number;
    }[]
  | null;

type TrainingAttemptRow = {
  id: string;
  score: number;
  passed: boolean;
  feedback: any;
  completed_at: string;
  communication_training_modules: TrainingModuleRelation;
};

export default async function TrainingResultPage({ params }: PageProps) {
  const { assignmentId } = await params;

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data, error } = await supabase
    .from("communication_training_attempts")
    .select(
      `
      id,
      score,
      passed,
      feedback,
      completed_at,
      communication_training_modules (
        title,
        passing_score
      )
      `
    )
    .eq("assignment_id", assignmentId)
    .eq("user_id", user.id)
    .order("completed_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) throw new Error("Result not found.");

  const attempt = data as TrainingAttemptRow;
  const module = getFirstRelatedRow(attempt.communication_training_modules);
  const items = (attempt.feedback as any)?.items ?? [];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Training Result"
      description="Your latest quiz result and feedback."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {module?.title || "Training module"}
        </div>

        <div className="mt-4 text-5xl font-semibold tracking-tight text-slate-950">
          {attempt.score}%
        </div>

        <div className="mt-2 text-sm text-slate-500">
          Passing score: {module?.passing_score ?? "—"}%
        </div>

        <div
          className={[
            "mt-4 inline-flex rounded-full px-4 py-2 text-sm font-semibold",
            attempt.passed
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
          ].join(" ")}
        >
          {attempt.passed ? "Passed" : "Not passed yet"}
        </div>

        <div className="mt-6 flex gap-3">
          <Link
            href="/communication-excellence/training"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Back to training
          </Link>

          {!attempt.passed ? (
            <Link
              href={`/communication-excellence/training/${assignmentId}`}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
            >
              Try again
            </Link>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Feedback</h2>

        <div className="mt-5 space-y-4">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              No detailed feedback was recorded for this attempt.
            </div>
          ) : (
            items.map((item: any, index: number) => (
              <div
                key={index}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="font-semibold text-slate-950">
                  {index + 1}. {item.question}
                </div>

                <div className="mt-2 text-sm text-slate-600">
                  Your answer: {String(item.selected || "").toUpperCase()} |
                  Correct: {String(item.correct || "").toUpperCase()}
                </div>

                <div className="mt-2 text-sm font-semibold">
                  {item.isCorrect ? "Correct" : "Review this question"}
                </div>

                {item.explanation ? (
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {item.explanation}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </PageLayout>
  );
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}