import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ScenarioRow = {
  id: string;
  title: string;
  category: string | null;
  difficulty: string | null;
  opening_message: string | null;
  patient_persona: string | null;
  scenario_goal: string | null;
  is_active: boolean;
  created_at: string;
};

export default async function ScenarioLibraryPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_scenarios")
    .select(
      `
      id,
      title,
      category,
      difficulty,
      opening_message,
      patient_persona,
      scenario_goal,
      is_active,
      created_at
      `
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const scenarios = (data ?? []) as ScenarioRow[];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Scenario Library"
      description="Create and manage AI roleplay scenarios for communication training."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/scenario-library/new"
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
        >
          Create scenario
        </Link>

        <Link
          href="/communication-excellence/scenarios"
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
        >
          View learner scenarios
        </Link>
      </div>

      <section className="grid gap-4">
        {scenarios.length === 0 ? (
          <EmptyState text="No scenarios created yet." />
        ) : (
          scenarios.map((scenario) => (
            <Link
              key={scenario.id}
              href={`/communication-excellence/admin/scenario-library/${scenario.id}`}
              className="block rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:bg-slate-50"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Badge label={scenario.category || "general"} />
                    <Badge label={scenario.difficulty || "beginner"} />
                    <Badge label={scenario.is_active ? "active" : "inactive"} />
                  </div>

                  <h2 className="mt-4 text-lg font-semibold text-slate-950">
                    {scenario.title}
                  </h2>

                  {scenario.scenario_goal ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                      {scenario.scenario_goal}
                    </p>
                  ) : null}
                </div>

                <div className="text-sm font-semibold text-slate-700">
                  Edit →
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </PageLayout>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
      {label.replaceAll("_", " ")}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}