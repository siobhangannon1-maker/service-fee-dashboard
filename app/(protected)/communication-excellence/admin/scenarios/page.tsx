import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  searchParams?: Promise<{
    category?: string;
    difficulty?: string;
  }>;
};

type ScenarioRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  difficulty: string;
  estimated_minutes: number;
};

type AttemptRow = {
  scenario_id: string;
  score: number | null;
  status: string;
  completed_at: string | null;
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "nervous_patients", label: "Nervous Patients" },
  { value: "cost_conversations", label: "Cost Conversations" },
  { value: "complaints", label: "Complaints" },
  { value: "referrals", label: "Referrals" },
  { value: "emergencies", label: "Emergencies" },
  { value: "phone_skills", label: "Phone Skills" },
  { value: "surgical_communication", label: "Surgical Communication" },
  { value: "general", label: "General" },
];

const DIFFICULTY_OPTIONS = [
  { value: "all", label: "All difficulties" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export default async function ScenariosPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedCategory = resolvedSearchParams?.category || "all";
  const selectedDifficulty = resolvedSearchParams?.difficulty || "all";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  let query = supabase
    .from("communication_scenarios")
    .select("id, title, description, category, difficulty, estimated_minutes")
    .eq("is_active", true)
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (selectedCategory !== "all") {
    query = query.eq("category", selectedCategory);
  }

  if (selectedDifficulty !== "all") {
    query = query.eq("difficulty", selectedDifficulty);
  }

  const [scenariosResult, attemptsResult] = await Promise.all([
    query,
    supabase
      .from("communication_scenario_attempts")
      .select("scenario_id, score, status, completed_at")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false }),
  ]);

  if (scenariosResult.error) throw new Error(scenariosResult.error.message);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);

  const scenarios = (scenariosResult.data ?? []) as ScenarioRow[];
  const attempts = (attemptsResult.data ?? []) as AttemptRow[];

  function latestAttempt(scenarioId: string) {
    return attempts.find((attempt) => attempt.scenario_id === scenarioId);
  }

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Scenario Practice"
      description="Practise patient communication scenarios using text chat or voice roleplay."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <form method="get" className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-slate-700">
              Category
            </div>
            <select
              name="category"
              defaultValue={selectedCategory}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-slate-700">
              Difficulty
            </div>
            <select
              name="difficulty"
              defaultValue={selectedDifficulty}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            >
              {DIFFICULTY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="self-end rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Apply filters
          </button>
        </form>
      </section>

      {scenarios.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          No published scenarios match these filters.
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2">
          {scenarios.map((scenario) => {
            const attempt = latestAttempt(scenario.id);

            return (
              <div
                key={scenario.id}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-wrap gap-2">
                  <Badge label={formatLabel(scenario.category)} />
                  <Badge label={formatLabel(scenario.difficulty)} />
                  <Badge label={`${scenario.estimated_minutes} min`} />
                </div>

                <div className="mt-4 text-lg font-semibold text-slate-950">
                  {scenario.title}
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {scenario.description || "No description added."}
                </p>

                <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  Latest score:{" "}
                  <span className="font-semibold text-slate-950">
                    {attempt?.score !== null && attempt?.score !== undefined
                      ? `${attempt.score}%`
                      : "—"}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/communication-excellence/scenarios/${scenario.id}`}
                    className="inline-flex rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900"
                  >
                    Start text chat
                  </Link>

                  <Link
                    href={`/communication-excellence/scenarios/${scenario.id}/voice`}
                    className="inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
                  >
                    Start voice roleplay
                  </Link>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </PageLayout>
  );
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
      {label}
    </span>
  );
}