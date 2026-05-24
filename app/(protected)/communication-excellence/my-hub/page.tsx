import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type AssignmentRow = {
  id: string;
  status: string;
  due_date: string | null;
  communication_training_modules:
    | {
        title: string;
        description: string | null;
        passing_score: number;
      }[]
    | null;
};

type ScoreRow = {
  score: number;
  evidence_count: number;
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
  due_date: string | null;
};

export default async function CommunicationMyHubPage() {
  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const [assignmentsResult, scoresResult, microlearningResult, profileResult] =
    await Promise.all([
      supabase
        .from("communication_training_assignments")
        .select(
          `
          id,
          status,
          due_date,
          communication_training_modules (
            title,
            description,
            passing_score
          )
        `
        )
        .eq("assigned_to_user_id", user.id)
        .order("assigned_at", { ascending: false }),

      supabase
        .from("communication_skill_scores")
        .select(
          `
          score,
          evidence_count,
          communication_competencies (
            name,
            description
          )
        `
        )
        .eq("user_id", user.id),

      supabase
        .from("communication_microlearning")
        .select("id, title, description, status, due_date")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),

      supabase
        .from("communication_staff_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (scoresResult.error) throw new Error(scoresResult.error.message);
  if (microlearningResult.error) {
    throw new Error(microlearningResult.error.message);
  }
  if (profileResult.error) throw new Error(profileResult.error.message);

  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const scores = (scoresResult.data ?? []) as ScoreRow[];
  const microlearning = (microlearningResult.data ?? []) as MicrolearningRow[];
  const profile = profileResult.data;

  const completedCount = assignments.filter(
    (assignment) => assignment.status === "completed"
  ).length;

  const averageScore =
    scores.length > 0
      ? Math.round(
          scores.reduce((sum, row) => sum + Number(row.score || 0), 0) /
            scores.length
        )
      : 0;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="My Communication Hub"
      description="Your personalised training, competency scores, targets and microlearning."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Assigned Modules" value={String(assignments.length)} />
        <MetricCard title="Completed" value={String(completedCount)} />
        <MetricCard title="Average Score" value={`${averageScore}%`} />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Personal focus</h2>
        <p className="mt-2 text-sm text-slate-600">
          {profile?.current_focus || "No personal focus has been set yet."}
        </p>
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          Target score:{" "}
          <span className="font-semibold text-slate-950">
            {profile?.target_score ?? 85}%
          </span>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Competency scores">
          {scores.length === 0 ? (
            <EmptyState text="No competency scores yet." />
          ) : (
            <div className="space-y-3">
              {scores.map((row, index) => {
                const competency = getFirstRelatedRow(
                  row.communication_competencies
                );

                return (
                  <div
                    key={`${competency?.name || "competency"}-${index}`}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-semibold text-slate-950">
                          {competency?.name || "Unknown competency"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.evidence_count} evidence item(s)
                        </div>
                      </div>
                      <div className="text-2xl font-semibold text-slate-950">
                        {row.score}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Microlearning">
          {microlearning.length === 0 ? (
            <EmptyState text="No microlearning assigned yet." />
          ) : (
            <div className="space-y-3">
              {microlearning.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="font-semibold text-slate-950">
                    {item.title}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.description}
                  </p>
                  <div className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {item.status}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="Assigned training">
        {assignments.length === 0 ? (
          <EmptyState text="No training has been assigned yet." />
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
                  <div className="font-semibold text-slate-950">
                    {module?.title || "Unknown module"}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {module?.description}
                  </p>
                  <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                    {assignment.status}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
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
      <div className="mt-4">{children}</div>
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