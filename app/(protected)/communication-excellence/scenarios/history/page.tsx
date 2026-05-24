import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ScenarioRelation = {
  title: string;
  description: string | null;
}[] | null;

type AttemptRow = {
  id: string;
  scenario_id: string;
  status: string;
  score: number | null;
  feedback: any;
  started_at: string;
  completed_at: string | null;
  communication_scenarios: ScenarioRelation;
};

export default async function ScenarioHistoryPage() {
  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data, error } = await supabase
    .from("communication_scenario_attempts")
    .select(
      `
      id,
      scenario_id,
      status,
      score,
      feedback,
      started_at,
      completed_at,
      communication_scenarios (
        title,
        description
      )
      `
    )
    .eq("user_id", user.id)
    .order("started_at", { ascending: false });

  if (error) throw new Error(error.message);

  const attempts = (data ?? []) as AttemptRow[];

  const completedAttempts = attempts.filter(
    (attempt) => attempt.status === "completed"
  );

  const averageScore =
    completedAttempts.length > 0
      ? Math.round(
          completedAttempts.reduce(
            (sum, attempt) => sum + Number(attempt.score || 0),
            0
          ) / completedAttempts.length
        )
      : 0;

  const bestScore =
    completedAttempts.length > 0
      ? Math.max(
          ...completedAttempts.map((attempt) => Number(attempt.score || 0))
        )
      : 0;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Scenario History"
      description="Review your previous patient communication scenario attempts."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Attempts" value={String(attempts.length)} />
        <MetricCard title="Completed" value={String(completedAttempts.length)} />
        <MetricCard title="Average Score" value={`${averageScore}%`} />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Attempt history
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Your best score so far is {bestScore}%.
            </p>
          </div>

          <Link
            href="/communication-excellence/scenarios"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Practise scenarios
          </Link>
        </div>

        <div className="mt-6 space-y-3">
          {attempts.length === 0 ? (
            <EmptyState text="No scenario attempts yet." />
          ) : (
            attempts.map((attempt) => {
              const scenario = getFirstRelatedRow(
                attempt.communication_scenarios
              );

              return (
                <div
                  key={attempt.id}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {scenario?.title || "Unknown scenario"}
                      </div>

                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {scenario?.description}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusBadge label={attempt.status} />

                        {attempt.completed_at ? (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            Completed: {formatDateTime(attempt.completed_at)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                            In progress
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-5 py-4 text-center">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Score
                      </div>
                      <div className="mt-1 text-3xl font-semibold text-slate-950">
                        {attempt.score === null ||
                        attempt.score === undefined
                          ? "—"
                          : `${attempt.score}%`}
                      </div>
                    </div>
                  </div>

                  {attempt.status === "completed" ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-4">
                      <ScoreMini
                        title="Empathy"
                        value={attempt.feedback?.empathy_score}
                      />
                      <ScoreMini
                        title="Clarity"
                        value={attempt.feedback?.clarity_score}
                      />
                      <ScoreMini
                        title="Professionalism"
                        value={attempt.feedback?.professionalism_score}
                      />
                      <ScoreMini
                        title="Escalation"
                        value={attempt.feedback?.escalation_score}
                      />
                    </div>
                  ) : null}

                  {attempt.feedback?.summary ? (
                    <p className="mt-4 text-sm leading-6 text-slate-600">
                      {attempt.feedback.summary}
                    </p>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href={`/communication-excellence/scenarios/${attempt.scenario_id}/attempt/${attempt.id}`}
                      className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
                    >
                      View attempt
                    </Link>

                    <Link
                      href={`/communication-excellence/scenarios/${attempt.scenario_id}`}
                      className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
                    >
                      Try again
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </PageLayout>
  );
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function ScoreMini({
  title,
  value,
}: {
  title: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 text-center ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-950">
        {value === null || value === undefined ? "—" : `${value}%`}
      </div>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const styles =
    label === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-blue-50 text-blue-700 ring-blue-200";

  return (
    <span
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold capitalize ring-1",
        styles,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}