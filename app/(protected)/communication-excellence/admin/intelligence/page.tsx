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
};

type ScenarioAttemptRow = {
  id: string;
  user_id: string;
  scenario_id: string;
  status: string;
  score: number | null;
  feedback: any;
  completed_at: string | null;
  communication_scenarios:
    | {
        title: string;
        category: string;
        difficulty: string;
      }[]
    | null;
};

type SkillScoreRow = {
  user_id: string;
  score: number;
  communication_competencies:
    | {
        name: string;
      }[]
    | null;
};

type MicrolearningRow = {
  id: string;
  user_id: string;
  status: string;
  due_date: string | null;
};

type CoachingFeedbackRow = {
  id: string;
  user_id: string;
  recommended_focus: string[];
  improvement_areas: string[];
  created_at: string;
};

type ManagerSummaryRow = {
  id: string;
  overall_summary: string;
  strengths: string[];
  risks: string[];
  coaching_priorities: string[];
  recommended_actions: string[];
  created_at: string;
};

type CallReviewRow = {
  id: string;
  reviewed_user_id: string | null;
  overall_score: number;
  empathy_score: number;
  clarity_score: number;
  professionalism_score: number;
  escalation_score: number;
  created_at: string;
};

export default async function CommunicationIntelligencePage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [
    profilesResult,
    assignmentsResult,
    scenarioAttemptsResult,
    skillScoresResult,
    microlearningResult,
    managerSummaryResult,
    coachingResult,
    callReviewsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role"),

    supabase
      .from("communication_training_assignments")
      .select("id, assigned_to_user_id, status, due_date"),

    supabase
      .from("communication_scenario_attempts")
      .select(
        `
        id,
        user_id,
        scenario_id,
        status,
        score,
        feedback,
        completed_at,
        communication_scenarios (
          title,
          category,
          difficulty
        )
        `
      )
      .eq("status", "completed")
      .order("completed_at", { ascending: false }),

    supabase
      .from("communication_skill_scores")
      .select(
        `
        user_id,
        score,
        communication_competencies (
          name
        )
        `
      ),

    supabase
      .from("communication_microlearning")
      .select("id, user_id, status, due_date"),

    supabase
      .from("communication_manager_summaries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1),

    supabase
      .from("communication_coaching_feedback")
      .select("id, user_id, recommended_focus, improvement_areas, created_at")
      .order("created_at", { ascending: false }),

    supabase
      .from("communication_call_reviews")
      .select(
        `
        id,
        reviewed_user_id,
        overall_score,
        empathy_score,
        clarity_score,
        professionalism_score,
        escalation_score,
        created_at
        `
      )
      .order("created_at", { ascending: false }),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (scenarioAttemptsResult.error) {
    throw new Error(scenarioAttemptsResult.error.message);
  }
  if (skillScoresResult.error) throw new Error(skillScoresResult.error.message);
  if (microlearningResult.error) throw new Error(microlearningResult.error.message);
  if (managerSummaryResult.error) {
    throw new Error(managerSummaryResult.error.message);
  }
  if (coachingResult.error) throw new Error(coachingResult.error.message);
  if (callReviewsResult.error) throw new Error(callReviewsResult.error.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const scenarioAttempts =
    (scenarioAttemptsResult.data ?? []) as ScenarioAttemptRow[];
  const skillScores = (skillScoresResult.data ?? []) as SkillScoreRow[];
  const microlearning = (microlearningResult.data ?? []) as MicrolearningRow[];
  const latestManagerSummary =
    ((managerSummaryResult.data?.[0] ?? null) as ManagerSummaryRow | null);
  const coaching = (coachingResult.data ?? []) as CoachingFeedbackRow[];
  const callReviews = (callReviewsResult.data ?? []) as CallReviewRow[];

  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "completed"
  );

  const overdueAssignments = assignments.filter((assignment) => {
    if (!assignment.due_date || assignment.status === "completed") return false;
    return assignment.due_date < getTodayIso();
  });

  const openMicrolearning = microlearning.filter(
    (item) => item.status !== "completed"
  );

  const averageScenarioScore = average(
    scenarioAttempts.map((attempt) => Number(attempt.score || 0))
  );

  const averageEmpathy = average(
    scenarioAttempts.map((attempt) => Number(attempt.feedback?.empathy_score || 0))
  );

  const averageClarity = average(
    scenarioAttempts.map((attempt) => Number(attempt.feedback?.clarity_score || 0))
  );

  const averageEscalation = average(
    scenarioAttempts.map((attempt) =>
      Number(attempt.feedback?.escalation_score || 0)
    )
  );

  const averageCallScore = average(
    callReviews.map((review) => Number(review.overall_score || 0))
  );

  const averageCallEmpathy = average(
    callReviews.map((review) => Number(review.empathy_score || 0))
  );

  const averageCallClarity = average(
    callReviews.map((review) => Number(review.clarity_score || 0))
  );

  const averageCallEscalation = average(
    callReviews.map((review) => Number(review.escalation_score || 0))
  );

  const trainingCompletionRate =
    assignments.length > 0
      ? Math.round((completedAssignments.length / assignments.length) * 100)
      : 0;

  const staffLeaderboard = buildStaffLeaderboard({
    profiles,
    scenarioAttempts,
    assignments,
    skillScores,
    callReviews,
  });

  const weakestCompetencies = buildWeakestCompetencies(skillScores);
  const scenarioPerformance = buildScenarioPerformance(scenarioAttempts);
  const coachingThemes = buildCoachingThemes(coaching);
  const callReviewLeaderboard = buildCallReviewLeaderboard({
    profiles,
    callReviews,
  });

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Practice Communication Intelligence"
      description="Practice-wide trends, coaching risks, staff performance and communication training intelligence."
    >
      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Latest AI Manager Summary
            </h2>

            {latestManagerSummary ? (
              <>
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  {latestManagerSummary.overall_summary}
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <SummaryMiniList
                    title="Risks"
                    items={latestManagerSummary.risks ?? []}
                  />
                  <SummaryMiniList
                    title="Priorities"
                    items={latestManagerSummary.coaching_priorities ?? []}
                  />
                  <SummaryMiniList
                    title="Actions"
                    items={latestManagerSummary.recommended_actions ?? []}
                  />
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-700">
                No manager summary has been generated yet.
              </p>
            )}
          </div>

          <Link
            href="/communication-excellence/admin/manager-summary"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Generate summary
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Avg Scenario Score" value={`${averageScenarioScore}%`} />
        <MetricCard title="Avg Empathy" value={`${averageEmpathy}%`} />
        <MetricCard title="Avg Clarity" value={`${averageClarity}%`} />
        <MetricCard title="Avg Escalation" value={`${averageEscalation}%`} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Avg Call Score" value={`${averageCallScore}%`} />
        <MetricCard title="Call Empathy" value={`${averageCallEmpathy}%`} />
        <MetricCard title="Call Clarity" value={`${averageCallClarity}%`} />
        <MetricCard title="Call Escalation" value={`${averageCallEscalation}%`} />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Training Completion" value={`${trainingCompletionRate}%`} />
        <MetricCard title="Overdue Training" value={String(overdueAssignments.length)} />
        <MetricCard title="Open Microlearning" value={String(openMicrolearning.length)} />
        <MetricCard title="Call Reviews" value={String(callReviews.length)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="Staff leaderboard">
          {staffLeaderboard.length === 0 ? (
            <EmptyState text="No staff performance yet." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600">
                      Staff
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Scenario Avg
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Scenarios
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Avg Call
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Calls
                    </th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-600">
                      Training %
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-600">
                      Weakest Area
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {staffLeaderboard.map((row) => (
                    <tr key={row.userId} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/communication-excellence/admin/staff/${row.userId}`}
                          className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                        <div className="mt-1 text-xs text-slate-400">
                          {row.email}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-slate-950">
                        {row.averageScenarioScore === null
                          ? "—"
                          : `${row.averageScenarioScore}%`}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {row.scenarioCount}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-slate-950">
                        {row.averageCallScore === null
                          ? "—"
                          : `${row.averageCallScore}%`}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {row.callReviewCount}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {row.trainingCompletionRate}%
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {row.weakestCompetency || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Weakest competencies">
          {weakestCompetencies.length === 0 ? (
            <EmptyState text="No competency scores yet." />
          ) : (
            <div className="space-y-3">
              {weakestCompetencies.map((row) => (
                <div
                  key={row.name}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {row.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.count} staff score(s)
                      </div>
                    </div>

                    <div className="text-2xl font-semibold text-slate-950">
                      {row.averageScore}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Scenario performance">
          {scenarioPerformance.length === 0 ? (
            <EmptyState text="No completed scenario attempts yet." />
          ) : (
            <div className="space-y-3">
              {scenarioPerformance.map((row) => (
                <div
                  key={row.scenarioId}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {row.title}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge label={formatLabel(row.category)} />
                        <Badge label={formatLabel(row.difficulty)} />
                        <Badge label={`${row.count} attempts`} />
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-semibold text-slate-950">
                        {row.averageScore}%
                      </div>
                      <div className="text-xs text-slate-400">average</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Call review leaderboard">
          {callReviewLeaderboard.length === 0 ? (
            <EmptyState text="No call reviews yet." />
          ) : (
            <div className="space-y-3">
              {callReviewLeaderboard.map((row) => (
                <Link
                  key={row.userId}
                  href={`/communication-excellence/admin/staff/${row.userId}`}
                  className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {row.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.count} call review(s)
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-semibold text-slate-950">
                        {row.averageScore}%
                      </div>
                      <div className="text-xs text-slate-400">average</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="Common coaching themes">
        {coachingThemes.length === 0 ? (
          <EmptyState text="No coaching themes yet." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {coachingThemes.map((theme) => (
              <div
                key={theme.label}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="font-semibold text-slate-950">
                    {theme.label}
                  </div>
                  <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                    {theme.count}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </PageLayout>
  );
}

function buildStaffLeaderboard({
  profiles,
  scenarioAttempts,
  assignments,
  skillScores,
  callReviews,
}: {
  profiles: ProfileRow[];
  scenarioAttempts: ScenarioAttemptRow[];
  assignments: AssignmentRow[];
  skillScores: SkillScoreRow[];
  callReviews: CallReviewRow[];
}) {
  return profiles
    .map((profile) => {
      const userScenarios = scenarioAttempts.filter(
        (attempt) => attempt.user_id === profile.id
      );

      const userAssignments = assignments.filter(
        (assignment) => assignment.assigned_to_user_id === profile.id
      );

      const completedAssignments = userAssignments.filter(
        (assignment) => assignment.status === "completed"
      );

      const userSkillScores = skillScores.filter(
        (score) => score.user_id === profile.id
      );

      const userCallReviews = callReviews.filter(
        (review) => review.reviewed_user_id === profile.id
      );

      const weakest = [...userSkillScores].sort(
        (a, b) => Number(a.score || 0) - Number(b.score || 0)
      )[0];

      const averageScenarioScore =
        userScenarios.length > 0
          ? average(userScenarios.map((attempt) => Number(attempt.score || 0)))
          : null;

      const averageCallScore =
        userCallReviews.length > 0
          ? average(userCallReviews.map((review) => Number(review.overall_score || 0)))
          : null;

      const trainingCompletionRate =
        userAssignments.length > 0
          ? Math.round((completedAssignments.length / userAssignments.length) * 100)
          : 0;

      return {
        userId: profile.id,
        name: profile.full_name || profile.email || "Unknown staff",
        email: profile.email || "",
        scenarioCount: userScenarios.length,
        averageScenarioScore,
        callReviewCount: userCallReviews.length,
        averageCallScore,
        trainingCompletionRate,
        weakestCompetency:
          getFirstRelatedRow(weakest?.communication_competencies)?.name || null,
      };
    })
    .filter(
      (row) =>
        row.scenarioCount > 0 ||
        row.callReviewCount > 0 ||
        row.trainingCompletionRate > 0 ||
        row.weakestCompetency
    )
    .sort((a, b) => {
      const aCombined = combinedScore(a.averageScenarioScore, a.averageCallScore);
      const bCombined = combinedScore(b.averageScenarioScore, b.averageCallScore);
      return bCombined - aCombined;
    });
}

function buildCallReviewLeaderboard({
  profiles,
  callReviews,
}: {
  profiles: ProfileRow[];
  callReviews: CallReviewRow[];
}) {
  return profiles
    .map((profile) => {
      const userReviews = callReviews.filter(
        (review) => review.reviewed_user_id === profile.id
      );

      if (userReviews.length === 0) return null;

      return {
        userId: profile.id,
        name: profile.full_name || profile.email || "Unknown staff",
        count: userReviews.length,
        averageScore: average(
          userReviews.map((review) => Number(review.overall_score || 0))
        ),
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.averageScore - b.averageScore) as {
      userId: string;
      name: string;
      count: number;
      averageScore: number;
    }[];
}

function SummaryMiniList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-blue-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
        {title}
      </div>

      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length === 0 ? (
          <li>—</li>
        ) : (
          items.slice(0, 4).map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </div>
  );
}

function buildWeakestCompetencies(skillScores: SkillScoreRow[]) {
  const map = new Map<string, { name: string; count: number; total: number }>();

  for (const score of skillScores) {
    const competency = getFirstRelatedRow(score.communication_competencies);
    const name = competency?.name || "Unknown competency";

    const existing = map.get(name) ?? {
      name,
      count: 0,
      total: 0,
    };

    existing.count += 1;
    existing.total += Number(score.score || 0);

    map.set(name, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      averageScore: Math.round(row.total / row.count),
    }))
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 8);
}

function buildScenarioPerformance(attempts: ScenarioAttemptRow[]) {
  const map = new Map<
    string,
    {
      scenarioId: string;
      title: string;
      category: string;
      difficulty: string;
      count: number;
      total: number;
    }
  >();

  for (const attempt of attempts) {
    const scenario = getFirstRelatedRow(attempt.communication_scenarios);

    const existing = map.get(attempt.scenario_id) ?? {
      scenarioId: attempt.scenario_id,
      title: scenario?.title || "Unknown scenario",
      category: scenario?.category || "general",
      difficulty: scenario?.difficulty || "beginner",
      count: 0,
      total: 0,
    };

    existing.count += 1;
    existing.total += Number(attempt.score || 0);

    map.set(attempt.scenario_id, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      averageScore: Math.round(row.total / row.count),
    }))
    .sort((a, b) => a.averageScore - b.averageScore);
}

function buildCoachingThemes(coaching: CoachingFeedbackRow[]) {
  const map = new Map<string, number>();

  for (const item of coaching) {
    const allThemes = [
      ...(item.recommended_focus ?? []),
      ...(item.improvement_areas ?? []),
    ];

    for (const theme of allThemes) {
      const label = String(theme).trim();
      if (!label) continue;

      map.set(label, (map.get(label) ?? 0) + 1);
    }
  }

  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function average(values: number[]) {
  const validValues = values.filter((value) => !Number.isNaN(value));

  if (validValues.length === 0) return 0;

  return Math.round(
    validValues.reduce((sum, value) => sum + value, 0) / validValues.length
  );
}

function combinedScore(
  scenarioScore: number | null,
  callScore: number | null
) {
  const values = [scenarioScore, callScore].filter(
    (value): value is number => value !== null
  );

  if (values.length === 0) return 0;

  return average(values);
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
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

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
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