import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ userId: string }>;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
};

type AssignmentRow = {
  id: string;
  module_id: string;
  status: string;
  due_date: string | null;
  assigned_at: string;
  completed_at: string | null;
  communication_training_modules:
    | {
        title: string;
        passing_score: number;
      }[]
    | null;
};

type AttemptRow = {
  id: string;
  assignment_id: string | null;
  module_id: string;
  score: number;
  passed: boolean;
  completed_at: string;
  communication_training_modules:
    | {
        title: string;
      }[]
    | null;
};

type SkillScoreRow = {
  id: string;
  score: number;
  evidence_count: number;
  last_updated_at: string;
  communication_competencies:
    | {
        name: string;
        description: string | null;
      }[]
    | null;
};

type MicrolearningRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_reason: string | null;
  due_date: string | null;
  completed_at: string | null;
};

type ScenarioAttemptRow = {
  id: string;
  scenario_id: string;
  status: string;
  score: number | null;
  feedback: any;
  started_at: string;
  completed_at: string | null;
  communication_scenarios:
    | {
        title: string;
      }[]
    | null;
};

export default async function StaffDetailPage({ params }: PageProps) {
  const { userId } = await params;

  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [
    profileResult,
    assignmentsResult,
    attemptsResult,
    scoresResult,
    microlearningResult,
    scenarioAttemptsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .eq("id", userId)
      .single(),

    supabase
      .from("communication_training_assignments")
      .select(
        `
        id,
        module_id,
        status,
        due_date,
        assigned_at,
        completed_at,
        communication_training_modules (
          title,
          passing_score
        )
        `
      )
      .eq("assigned_to_user_id", userId)
      .order("assigned_at", { ascending: false }),

    supabase
      .from("communication_training_attempts")
      .select(
        `
        id,
        assignment_id,
        module_id,
        score,
        passed,
        completed_at,
        communication_training_modules (
          title
        )
        `
      )
      .eq("user_id", userId)
      .order("completed_at", { ascending: false }),

    supabase
      .from("communication_skill_scores")
      .select(
        `
        id,
        score,
        evidence_count,
        last_updated_at,
        communication_competencies (
          name,
          description
        )
        `
      )
      .eq("user_id", userId)
      .order("score", { ascending: true }),

    supabase
      .from("communication_microlearning")
      .select(
        "id, title, description, status, assigned_reason, due_date, completed_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),

    supabase
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
          title
        )
        `
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  if (scoresResult.error) throw new Error(scoresResult.error.message);
  if (microlearningResult.error) {
    throw new Error(microlearningResult.error.message);
  }
  if (scenarioAttemptsResult.error) {
    throw new Error(scenarioAttemptsResult.error.message);
  }

  const profile = profileResult.data as ProfileRow;
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const scores = (scoresResult.data ?? []) as SkillScoreRow[];
  const microlearning = (microlearningResult.data ?? []) as MicrolearningRow[];
  const scenarioAttempts =
    (scenarioAttemptsResult.data ?? []) as ScenarioAttemptRow[];

  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "completed"
  );

  const overdueAssignments = assignments.filter((assignment) => {
    if (!assignment.due_date || assignment.status === "completed") return false;
    return assignment.due_date < getTodayIso();
  });

  const completedScenarioAttempts = scenarioAttempts.filter(
    (attempt) => attempt.status === "completed"
  );

  const averageAttemptScore =
    attempts.length > 0
      ? Math.round(
          attempts.reduce(
            (sum, attempt) => sum + Number(attempt.score || 0),
            0
          ) / attempts.length
        )
      : 0;

  const averageScenarioScore =
    completedScenarioAttempts.length > 0
      ? Math.round(
          completedScenarioAttempts.reduce(
            (sum, attempt) => sum + Number(attempt.score || 0),
            0
          ) / completedScenarioAttempts.length
        )
      : 0;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={profile.full_name || profile.email || "Staff member"}
      description="Individual training history, quiz attempts, scenario attempts, completion status and competency profile."
    >
      <Link
        href="/communication-excellence/admin/staff"
        className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        ← Back to staff analytics
      </Link>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
              {profile.role}
            </div>

            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              {profile.full_name || profile.email}
            </h2>

            <p className="mt-3 text-sm leading-6 text-white/75">
              {profile.email}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-6">
        <MetricCard title="Assigned" value={String(assignments.length)} />
        <MetricCard title="Completed" value={String(completedAssignments.length)} />
        <MetricCard title="Overdue" value={String(overdueAssignments.length)} />
        <MetricCard title="Avg Quiz" value={`${averageAttemptScore}%`} />
        <MetricCard title="Scenarios" value={String(completedScenarioAttempts.length)} />
        <MetricCard title="Avg Scenario" value={`${averageScenarioScore}%`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Competency profile">
          {scores.length === 0 ? (
            <EmptyState text="No competency scores yet." />
          ) : (
            <div className="space-y-3">
              {scores.map((score) => {
                const competency = getFirstRelatedRow(
                  score.communication_competencies
                );

                return (
                  <div
                    key={score.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-slate-950">
                          {competency?.name || "Unknown competency"}
                        </div>

                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {competency?.description}
                        </p>

                        <div className="mt-2 text-xs text-slate-400">
                          Evidence: {score.evidence_count}
                        </div>
                      </div>

                      <div className="text-2xl font-semibold text-slate-950">
                        {score.score}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Training assignments">
          {assignments.length === 0 ? (
            <EmptyState text="No assignments yet." />
          ) : (
            <div className="space-y-3">
              {assignments.map((assignment) => {
                const module = getFirstRelatedRow(
                  assignment.communication_training_modules
                );

                return (
                  <div
                    key={assignment.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-semibold text-slate-950">
                          {module?.title || "Unknown module"}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <StatusBadge label={assignment.status} />

                          {assignment.due_date ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                              Due: {assignment.due_date}
                            </span>
                          ) : null}

                          {assignment.completed_at ? (
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                              Completed: {formatDate(assignment.completed_at)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="text-sm text-slate-500">
                        Pass: {module?.passing_score ?? "—"}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="Scenario attempts">
        {scenarioAttempts.length === 0 ? (
          <EmptyState text="No scenario attempts yet." />
        ) : (
          <div className="space-y-3">
            {scenarioAttempts.map((attempt) => {
              const scenario = getFirstRelatedRow(
                attempt.communication_scenarios
              );

              return (
                <div
                  key={attempt.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {scenario?.title || "Unknown scenario"}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge label={attempt.status} />

                        {attempt.completed_at ? (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            Completed: {formatDate(attempt.completed_at)}
                          </span>
                        ) : null}
                      </div>

                      {attempt.feedback?.summary ? (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          {attempt.feedback.summary}
                        </p>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Score
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-slate-950">
                        {attempt.score === null || attempt.score === undefined
                          ? "—"
                          : `${attempt.score}%`}
                      </div>
                    </div>
                  </div>

                  {attempt.status === "completed" ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-4">
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
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Microlearning">
        {microlearning.length === 0 ? (
          <EmptyState text="No microlearning tasks yet." />
        ) : (
          <div className="space-y-3">
            {microlearning.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {item.title}
                    </div>

                    {item.description ? (
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {item.description}
                      </p>
                    ) : null}

                    {item.assigned_reason ? (
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Reason: {item.assigned_reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <StatusBadge label={item.status} />

                    {item.due_date ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        Due: {item.due_date}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Quiz attempts">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Module
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Score
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Result
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {attempts.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No quiz attempts yet.
                  </td>
                </tr>
              ) : (
                attempts.map((attempt) => {
                  const module = getFirstRelatedRow(
                    attempt.communication_training_modules
                  );

                  return (
                    <tr key={attempt.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDateTime(attempt.completed_at)}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {module?.title || "Unknown"}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-slate-950">
                        {attempt.score}%
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge
                          label={attempt.passed ? "passed" : "not passed"}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </PageLayout>
  );
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
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

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
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
  const normalized = label.toLowerCase();

  const styles =
    normalized === "completed" || normalized === "passed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : normalized === "attempted" || normalized === "not passed"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
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
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
      {text}
    </div>
  );
}