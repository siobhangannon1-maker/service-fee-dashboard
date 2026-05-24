import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ScenarioRelation = {
  title: string;
}[] | null;

type AttemptRow = {
  id: string;
  user_id: string;
  scenario_id: string;
  status: string;
  score: number | null;
  feedback: any;
  started_at: string;
  completed_at: string | null;
  communication_scenarios: ScenarioRelation;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
};

export default async function ScenarioAnalyticsPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [attemptsResult, profilesResult] = await Promise.all([
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
        started_at,
        completed_at,
        communication_scenarios (
          title
        )
        `
      )
      .order("started_at", { ascending: false }),

    supabase.from("profiles").select("id, full_name, email, role"),
  ]);

  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const profiles = (profilesResult.data ?? []) as ProfileRow[];

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
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

  const lowScoreCount = completedAttempts.filter(
    (attempt) => Number(attempt.score || 0) < 80
  ).length;

  const scenarioSummaries = buildScenarioSummaries(completedAttempts);
  const staffSummaries = buildStaffSummaries(completedAttempts, profileById);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Scenario Analytics"
      description="Review AI scenario performance across staff and scenarios."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Total Attempts" value={String(attempts.length)} />
        <MetricCard title="Completed" value={String(completedAttempts.length)} />
        <MetricCard title="Average Score" value={`${averageScore}%`} />
        <MetricCard title="Below Target" value={String(lowScoreCount)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Scenario performance">
          <div className="space-y-3">
            {scenarioSummaries.length === 0 ? (
              <EmptyState text="No completed scenario attempts yet." />
            ) : (
              scenarioSummaries.map((row) => (
                <div
                  key={row.scenarioId}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-950">
                        {row.title}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.count} completed attempt(s)
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
              ))
            )}
          </div>
        </Panel>

        <Panel title="Staff scenario performance">
          <div className="space-y-3">
            {staffSummaries.length === 0 ? (
              <EmptyState text="No staff scenario scores yet." />
            ) : (
              staffSummaries.map((row) => (
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
                        {row.count} completed scenario(s)
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
              ))
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Recent attempts">
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Staff
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Scenario
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Score
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Empathy
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Clarity
                </th>
                <th className="px-4 py-3 text-right font-semibold text-slate-600">
                  Escalation
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 bg-white">
              {attempts.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No scenario attempts yet.
                  </td>
                </tr>
              ) : (
                attempts.slice(0, 100).map((attempt) => {
                  const profile = profileById.get(attempt.user_id);
                  const scenario = getFirstRelatedRow(
                    attempt.communication_scenarios
                  );

                  return (
                    <tr key={attempt.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDateTime(attempt.started_at)}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {profile?.full_name || profile?.email || "Unknown"}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {scenario?.title || "Unknown"}
                      </td>

                      <td className="px-4 py-3 text-right font-semibold text-slate-950">
                        {attempt.score === null || attempt.score === undefined
                          ? "—"
                          : `${attempt.score}%`}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatScore(attempt.feedback?.empathy_score)}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatScore(attempt.feedback?.clarity_score)}
                      </td>

                      <td className="px-4 py-3 text-right text-slate-700">
                        {formatScore(attempt.feedback?.escalation_score)}
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

function buildScenarioSummaries(attempts: AttemptRow[]) {
  const map = new Map<
    string,
    { scenarioId: string; title: string; count: number; total: number }
  >();

  for (const attempt of attempts) {
    const scenario = getFirstRelatedRow(attempt.communication_scenarios);

    const existing =
      map.get(attempt.scenario_id) ??
      {
        scenarioId: attempt.scenario_id,
        title: scenario?.title || "Unknown scenario",
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

function buildStaffSummaries(
  attempts: AttemptRow[],
  profileById: Map<string, ProfileRow>
) {
  const map = new Map<
    string,
    { userId: string; name: string; count: number; total: number }
  >();

  for (const attempt of attempts) {
    const profile = profileById.get(attempt.user_id);

    const existing =
      map.get(attempt.user_id) ??
      {
        userId: attempt.user_id,
        name: profile?.full_name || profile?.email || "Unknown staff",
        count: 0,
        total: 0,
      };

    existing.count += 1;
    existing.total += Number(attempt.score || 0);

    map.set(attempt.user_id, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      averageScore: Math.round(row.total / row.count),
    }))
    .sort((a, b) => a.averageScore - b.averageScore);
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}

function formatScore(value: any) {
  if (value === null || value === undefined) return "—";
  return `${Number(value)}%`;
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