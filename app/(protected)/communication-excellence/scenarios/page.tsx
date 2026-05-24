import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ScenarioRow = {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  is_published: boolean;
  created_at: string;
};

export default async function ScenarioAdminPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const { data, error } = await supabase
    .from("communication_scenarios")
    .select("id, title, description, is_active, is_published, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const scenarios = (data ?? []) as ScenarioRow[];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Scenario Admin"
      description="Create and manage text-based AI patient communication scenarios."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Scenarios
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Build roleplay scenarios now. Voice can use the same scenarios later.
            </p>
          </div>

          <Link
            href="/communication-excellence/admin/scenarios/new"
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            New scenario
          </Link>
        </div>

        <div className="mt-6 space-y-3">
          {scenarios.length === 0 ? (
            <EmptyState text="No scenarios created yet." />
          ) : (
            scenarios.map((scenario) => (
              <div
                key={scenario.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <Link
                      href={`/communication-excellence/admin/scenarios/${scenario.id}`}
                      className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                    >
                      {scenario.title}
                    </Link>

                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {scenario.description || "No description added."}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge label={scenario.is_published ? "Published" : "Draft"} />
                      <Badge label={scenario.is_active ? "Active" : "Inactive"} />
                    </div>
                  </div>

                  <Link
                    href={`/communication-excellence/scenarios/${scenario.id}`}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Preview
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </PageLayout>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
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