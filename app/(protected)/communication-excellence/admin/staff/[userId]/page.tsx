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
  reflection_notes: string | null;
  created_at: string;
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

type CoachingFeedbackRow = {
  id: string;
  overall_summary: string;
  strengths: string[];
  improvement_areas: string[];
  recommended_focus: string[];
  created_at: string;
};

type CallReviewRow = {
  id: string;
  file_name: string | null;
  overall_score: number;
  empathy_score: number;
  clarity_score: number;
  professionalism_score: number;
  escalation_score: number;
  ai_summary: string;
  strengths: string[];
  improvements: string[];
  created_at: string;
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
    coachingFeedbackResult,
    callReviewsResult,
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
        "id, title, description, status, assigned_reason, due_date, reflection_notes, completed_at, created_at"
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

    supabase
      .from("communication_coaching_feedback")
      .select(
        "id, overall_summary, strengths, improvement_areas, recommended_focus, created_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),

    supabase
      .from("communication_call_reviews")
      .select(
        `
        id,
        file_name,
        overall_score,
        empathy_score,
        clarity_score,
        professionalism_score,
        escalation_score,
        ai_summary,
        strengths,
        improvements,
        created_at
        `
      )
      .eq("reviewed_user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);
  if (scoresResult.error) throw new Error(scoresResult.error.message);
  if (microlearningResult.error) throw new Error(microlearningResult.error.message);

  if (scenarioAttemptsResult.error) {
    throw new Error(scenarioAttemptsResult.error.message);
  }

  if (coachingFeedbackResult.error) {
    throw new Error(coachingFeedbackResult.error.message);
  }

  if (callReviewsResult.error) {
    throw new Error(callReviewsResult.error.message);
  }

  const profile = profileResult.data as ProfileRow;
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];
  const scores = (scoresResult.data ?? []) as SkillScoreRow[];
  const microlearning = (microlearningResult.data ?? []) as MicrolearningRow[];
  const scenarioAttempts =
    (scenarioAttemptsResult.data ?? []) as ScenarioAttemptRow[];
  const coachingFeedback =
    (coachingFeedbackResult.data ?? []) as CoachingFeedbackRow[];
  const callReviews =
    (callReviewsResult.data ?? []) as CallReviewRow[];

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

  const averageCallScore =
    callReviews.length > 0
      ? Math.round(
          callReviews.reduce(
            (sum, review) => sum + Number(review.overall_score || 0),
            0
          ) / callReviews.length
        )
      : 0;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={profile.full_name || profile.email || "Staff member"}
      description="Individual training history, quiz attempts, scenario attempts, AI coaching feedback and competency profile."
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

      <section className="grid gap-4 md:grid-cols-7">
        <MetricCard title="Assigned" value={String(assignments.length)} />
        <MetricCard title="Completed" value={String(completedAssignments.length)} />
        <MetricCard title="Overdue" value={String(overdueAssignments.length)} />
        <MetricCard title="Avg Quiz" value={`${averageAttemptScore}%`} />
        <MetricCard title="Scenarios" value={String(completedScenarioAttempts.length)} />
        <MetricCard title="Avg Scenario" value={`${averageScenarioScore}%`} />
        <MetricCard title="Avg Calls" value={`${averageCallScore}%`} />
      </section>

      <Panel title="Call reviews">
        {callReviews.length === 0 ? (
          <EmptyState text="No call reviews yet." />
        ) : (
          <div className="space-y-4">
            {callReviews.map((review) => (
              <div
                key={review.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {review.file_name || "Manual transcript"}
                    </div>

                    <div className="mt-1 text-xs text-slate-400">
                      {formatDateTime(review.created_at)}
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {review.ai_summary}
                    </p>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Overall
                    </div>

                    <div className="mt-1 text-2xl font-semibold text-slate-950">
                      {review.overall_score}%
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <ScoreMini title="Empathy" value={review.empathy_score} />
                  <ScoreMini title="Clarity" value={review.clarity_score} />
                  <ScoreMini
                    title="Professionalism"
                    value={review.professionalism_score}
                  />
                  <ScoreMini
                    title="Escalation"
                    value={review.escalation_score}
                  />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <CoachingList
                    title="Strengths"
                    items={review.strengths || []}
                  />

                  <CoachingList
                    title="Improvements"
                    items={review.improvements || []}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
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

function CoachingList({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-blue-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length === 0 ? (
          <li>No items.</li>
        ) : (
          items.map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
      {text}
    </div>
  );
}
