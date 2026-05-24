import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
};

type AssignmentRow = {
  id: string;
  assigned_to_user_id: string;
  status: string;
  due_date: string | null;
  completed_at: string | null;
};

type AttemptRow = {
  id: string;
  user_id: string;
  score: number;
  passed: boolean;
  completed_at: string;
};

type SkillScoreRow = {
  user_id: string;
  score: number;
  evidence_count: number;
  communication_competencies:
    | {
        name: string;
      }[]
    | null;
};

type ScenarioAttemptRow = {
  id: string;
  user_id: string;
  score: number | null;
  status: string;
  completed_at: string | null;
};

export default async function StaffAnalyticsPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [
    profilesResult,
    assignmentsResult,
    attemptsResult,
    scoresResult,
    scenarioAttemptsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name", { ascending: true }),

    supabase
      .from("communication_training_assignments")
      .select("id, assigned_to_user_id, status, due_date, completed_at"),

    supabase
      .from("communication_training_attempts")
      .select("id, user_id, score, passed, completed_at")
      .order("completed_at", { ascending: false }),

    supabase
      .from("communication_skill_scores")
      .select(
        `
        user_id,
        score,
        evidence_count,
        communication_competencies (
          name
        )
        `
      ),

    supabase
      .from("communication_scenario_attempts")
      .select("id, user_id, score, status, completed_at")
      .order("completed_at", { ascending: false }),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  if (scoresResult.error) throw new Error(scoresResult.error.message);
  if (scenarioAttemptsResult.error) {
    throw new Error(scenarioAttemptsResult.error.message);
  }

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const scores = (scoresResult.data ?? []) as SkillScoreRow[];
  const scenarioAttempts =
    (scenarioAttemptsResult.data ?? []) as ScenarioAttemptRow[];

  const rows = profiles.map((profile) => {
    const userAssignments = assignments.filter(
      (assignment) => assignment.assigned_to_user_id === profile.id
    );

    const userAttempts = attempts.filter(
      (attempt) => attempt.user_id === profile.id
    );

    const userScenarioAttempts = scenarioAttempts.filter(
      (attempt) => attempt.user_id === profile.id
    );

    const completedScenarioAttempts = userScenarioAttempts.filter(
      (attempt) => attempt.status === "completed"
    );

    const userScores = scores.filter((score) => score.user_id === profile.id);

    const completedAssignments = userAssignments.filter(
      (assignment) => assignment.status === "completed"
    );

    const overdueAssignments = userAssignments.filter((assignment) => {
      if (!assignment.due_date || assignment.status === "completed") {
        return false;
      }

      return assignment.due_date < getTodayIso();
    });

    const averageAttemptScore =
      userAttempts.length > 0
        ? Math.round(
            userAttempts.reduce(
              (sum, attempt) => sum + Number(attempt.score || 0),
              0
            ) / userAttempts.length
          )
        : null;

    const averageScenarioScore =
      completedScenarioAttempts.length > 0
        ? Math.round(
            completedScenarioAttempts.reduce(
              (sum, attempt) => sum + Number(attempt.score || 0),
              0
            ) / completedScenarioAttempts.length
          )
        : null;

    const averageCompetencyScore =
      userScores.length > 0
        ? Math.round(
            userScores.reduce(
              (sum, score) => sum + Number(score.score || 0),
              0
            ) / userScores.length
          )
        : null;

    const weakestCompetency = [...userScores].sort(
      (a, b) => Number(a.score || 0) - Number(b.score || 0)
    )[0];

    const weakestCompetencyRelation = getFirstRelatedRow(
      weakestCompetency?.communication_competencies
    );

    return {
      profile,
      assignedCount: userAssignments.length,
      completedCount: completedAssignments.length,
      overdueCount: overdueAssignments.length,
      quizAttemptCount: userAttempts.length,
      scenarioAttemptCount: completedScenarioAttempts.length,
      averageAttemptScore,
      averageScenarioScore,
      averageCompetencyScore,
      weakestCompetency: weakestCompetencyRelation?.name ?? null,
    };
  });

  const activeRows = rows.filter(
    (row) =>
      row.assignedCount > 0 ||
      row.completedCount > 0 ||
      row.quizAttemptCount > 0 ||
      row.scenarioAttemptCount > 0 ||
      row.averageCompetencyScore !== null
  );

  const totalAssigned = assignments.length;
  const totalCompleted = assignments.filter(
    (assignment) => assignment.status === "completed"
  ).length;

  const completionRate =
    totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

  const averageScore =
    attempts.length > 0
      ? Math.round(
          attempts.reduce(
            (sum, attempt) => sum + Number(attempt.score || 0),
            0
          ) / attempts.length
        )
      : 0;

  const completedScenarioAttempts = scenarioAttempts.filter(
    (attempt) => attempt.status === "completed"
  );

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
      title="Staff Analytics"
      description="Review staff training completion, quiz scores, scenario attempts, overdue modules and competency weaknesses."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Staff with Activity"
          value={String(activeRows.length)}
        />
        <MetricCard title="Assigned Modules" value={String(totalAssigned)} />
        <MetricCard title="Completion Rate" value={`${completionRate}%`} />
        <MetricCard title="Avg Quiz Score" value={`${averageScore}%`} />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Scenario Attempts"
          value={String(completedScenarioAttempts.length)}
        />
        <MetricCard
          title="Avg Scenario Score"
          value={`${averageScenarioScore}%`}
        />
        <MetricCard
          title="Total Quiz Attempts"
          value={String(attempts.length)}
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Staff progress overview
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Click a staff member to review their detailed training, quiz and
              scenario history.
            </p>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Staff
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Role
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Assigned
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Completed
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Overdue
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Quiz Attempts
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Avg Quiz
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Scenarios
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Avg Scenario
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Avg Competency
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Weakest Area
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={row.profile.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/communication-excellence/admin/staff/${row.profile.id}`}
                      className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                    >
                      {row.profile.full_name ||
                        row.profile.email ||
                        "Unnamed staff"}
                    </Link>

                    <div className="mt-1 text-xs text-slate-400">
                      {row.profile.email}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-slate-600">
                    {row.profile.role}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.assignedCount}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.completedCount}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        row.overdueCount > 0
                          ? "font-semibold text-red-600"
                          : "text-slate-500"
                      }
                    >
                      {row.overdueCount}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.quizAttemptCount}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.averageAttemptScore === null
                      ? "—"
                      : `${row.averageAttemptScore}%`}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.scenarioAttemptCount}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.averageScenarioScore === null
                      ? "—"
                      : `${row.averageScenarioScore}%`}
                  </td>

                  <td className="px-4 py-3 text-right text-slate-700">
                    {row.averageCompetencyScore === null
                      ? "—"
                      : `${row.averageCompetencyScore}%`}
                  </td>

                  <td className="px-4 py-3 text-slate-600">
                    {row.weakestCompetency || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageLayout>
  );
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function MetricCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
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