import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";
import { generateManagerSummary } from "@/lib/communication-excellence/manager-summary-ai";

async function generateSummary() {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [
    scenarioAttemptsResult,
    assignmentsResult,
    microlearningResult,
    skillScoresResult,
    coachingResult,
  ] = await Promise.all([
    supabase
      .from("communication_scenario_attempts")
      .select("score, feedback, communication_scenarios(title)")
      .eq("status", "completed"),

    supabase
      .from("communication_training_assignments")
      .select("status, due_date"),

    supabase
      .from("communication_microlearning")
      .select("status"),

    supabase
      .from("communication_skill_scores")
      .select("score, communication_competencies(name)"),

    supabase
      .from("communication_coaching_feedback")
      .select("recommended_focus, improvement_areas")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (scenarioAttemptsResult.error) {
    throw new Error(scenarioAttemptsResult.error.message);
  }

  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (microlearningResult.error) throw new Error(microlearningResult.error.message);
  if (skillScoresResult.error) throw new Error(skillScoresResult.error.message);
  if (coachingResult.error) throw new Error(coachingResult.error.message);

  const scenarioAttempts = scenarioAttemptsResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];
  const microlearning = microlearningResult.data ?? [];
  const skillScores = skillScoresResult.data ?? [];
  const coaching = coachingResult.data ?? [];

  const averageScenarioScore = average(
    scenarioAttempts.map((row: any) => Number(row.score || 0))
  );

  const averageEmpathy = average(
    scenarioAttempts.map((row: any) => Number(row.feedback?.empathy_score || 0))
  );

  const averageClarity = average(
    scenarioAttempts.map((row: any) => Number(row.feedback?.clarity_score || 0))
  );

  const averageEscalation = average(
    scenarioAttempts.map((row: any) => Number(row.feedback?.escalation_score || 0))
  );

  const overdueTrainingCount = assignments.filter((assignment: any) => {
    if (!assignment.due_date || assignment.status === "completed") return false;
    return assignment.due_date < getTodayIso();
  }).length;

  const openMicrolearningCount = microlearning.filter(
    (item: any) => item.status !== "completed"
  ).length;

  const coachingThemes = Array.from(
    new Set(
      coaching.flatMap((item: any) => [
        ...(item.recommended_focus ?? []),
        ...(item.improvement_areas ?? []),
      ])
    )
  )
    .filter(Boolean)
    .slice(0, 20)
    .map(String);

  const weakestCompetencies = buildWeakestCompetencies(skillScores).map(
    (item) => `${item.name}: ${item.averageScore}%`
  );

  const lowScoringScenarios = scenarioAttempts
    .filter((row: any) => Number(row.score || 0) < 80)
    .map((row: any) => {
      const scenario = Array.isArray(row.communication_scenarios)
        ? row.communication_scenarios[0]
        : row.communication_scenarios;

      return `${scenario?.title || "Unknown scenario"}: ${row.score}%`;
    })
    .slice(0, 20);

  const summary = await generateManagerSummary({
    averageScenarioScore,
    averageEmpathy,
    averageClarity,
    averageEscalation,
    overdueTrainingCount,
    openMicrolearningCount,
    coachingThemes,
    weakestCompetencies,
    lowScoringScenarios,
  });

  const { error } = await supabase
    .from("communication_manager_summaries")
    .insert({
      summary_period: "current",
      overall_summary: summary.overall_summary,
      strengths: summary.strengths,
      risks: summary.risks,
      coaching_priorities: summary.coaching_priorities,
      recommended_actions: summary.recommended_actions,
      generated_by: user.id,
    });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_manager_summary_generated",
    entity_type: "communication_manager_summary",
    actor_user_id: user.id,
    metadata: {
      averageScenarioScore,
      averageEmpathy,
      averageClarity,
      averageEscalation,
      overdueTrainingCount,
      openMicrolearningCount,
    },
  });

  revalidatePath("/communication-excellence/admin/manager-summary");
}

export default async function ManagerSummaryPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_manager_summaries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);

  const summaries = data ?? [];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="AI Manager Summaries"
      description="Generate plain-English manager insights from communication training, scenarios, coaching and microlearning data."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Generate current summary
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              This reviews current Communication Excellence data and stores a
              manager-friendly summary.
            </p>
          </div>

          <form action={generateSummary}>
            <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              Generate summary
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-4">
        {summaries.length === 0 ? (
          <EmptyState text="No manager summaries generated yet." />
        ) : (
          summaries.map((summary: any) => (
            <div
              key={summary.id}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {formatDateTime(summary.created_at)}
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-700">
                {summary.overall_summary}
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-4">
                <ListBlock title="Strengths" items={summary.strengths ?? []} />
                <ListBlock title="Risks" items={summary.risks ?? []} />
                <ListBlock
                  title="Priorities"
                  items={summary.coaching_priorities ?? []}
                />
                <ListBlock
                  title="Actions"
                  items={summary.recommended_actions ?? []}
                />
              </div>
            </div>
          ))
        )}
      </section>
    </PageLayout>
  );
}

function buildWeakestCompetencies(rows: any[]) {
  const map = new Map<string, { name: string; count: number; total: number }>();

  for (const row of rows) {
    const competency = Array.isArray(row.communication_competencies)
      ? row.communication_competencies[0]
      : row.communication_competencies;

    const name = competency?.name || "Unknown competency";

    const existing = map.get(name) ?? {
      name,
      count: 0,
      total: 0,
    };

    existing.count += 1;
    existing.total += Number(row.score || 0);

    map.set(name, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      averageScore: Math.round(row.total / row.count),
    }))
    .sort((a, b) => a.averageScore - b.averageScore)
    .slice(0, 10);
}

function average(values: number[]) {
  const valid = values.filter((value) => !Number.isNaN(value));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
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

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length === 0 ? (
          <li>—</li>
        ) : (
          items.map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}