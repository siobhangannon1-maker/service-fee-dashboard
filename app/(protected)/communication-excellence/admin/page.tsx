import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";
import Link from "next/link";

type ModuleRow = {
  id: string;
  title: string;
  description: string | null;
  is_published: boolean;
  is_active: boolean;
  created_at: string;
};

type AssignmentRow = {
  id: string;
  status: string;
  assigned_at: string;
  completed_at: string | null;
};

export default async function CommunicationAdminPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const [modulesResult, assignmentsResult, competenciesResult, voiceResult] =
    await Promise.all([
      supabase
        .from("communication_training_modules")
        .select("id, title, description, is_published, is_active, created_at")
        .order("created_at", { ascending: false }),

      supabase
        .from("communication_training_assignments")
        .select("id, status, assigned_at, completed_at"),

      supabase
        .from("communication_competencies")
        .select("id, name")
        .eq("is_active", true),

      supabase
        .from("communication_voice_sessions")
        .select("id, status, created_at"),
    ]);

  const modules = (modulesResult.data ?? []) as ModuleRow[];
  const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
  const competencies = competenciesResult.data ?? [];
  const voiceSessions = voiceResult.data ?? [];

  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "completed"
  ).length;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Admin Dashboard"
      description="Manage training modules, staff completion, competencies and future voice coaching."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Modules" value={String(modules.length)} />
        <MetricCard title="Assignments" value={String(assignments.length)} />
        <MetricCard title="Completed" value={String(completedAssignments)} />
        <MetricCard title="Voice Sessions" value={String(voiceSessions.length)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Training modules
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Create training content, quizzes, competencies and assignments.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
  <Link
    href="/communication-excellence/admin/modules/new"
    className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
  >
    New module
  </Link>

  <Link
    href="/communication-excellence/admin/assignments"
    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
  >
    Assign training
  </Link>

  <Link
    href="/communication-excellence/admin/audit"
    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
  >
    Audit history
  </Link>
  <Link
  href="/communication-excellence/admin/staff"
  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
>
  Staff analytics
</Link>

<Link
  href="/communication-excellence/admin/competencies"
  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
>
  Competencies
</Link>

</div>
          </div>

          <div className="mt-5 space-y-3">
            {modules.length === 0 ? (
              <EmptyState text="No modules created yet." />
            ) : (
              modules.map((module) => (
                <div
                  key={module.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <Link
                    href={`/communication-excellence/admin/modules/${module.id}`}
                    className="font-semibold text-slate-950 underline-offset-4 hover:underline"
                  >
                    {module.title}
                  </Link>

                  <p className="mt-1 text-sm text-slate-500">
                    {module.description}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                      {module.is_published ? "Published" : "Draft"}
                    </span>

                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                      {module.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Competencies
          </h2>

          <div className="mt-4 space-y-2">
            {competencies.map((competency) => (
              <div
                key={competency.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700"
              >
                {competency.name}
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageLayout>
  );
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}