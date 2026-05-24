import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const sortOrder = Number(formData.get("sort_order") || 0);

  if (!name) {
    throw new Error("Competency name is required.");
  }

  const { error } = await supabase
    .from("communication_competencies")
    .insert({
      name,
      description,
      sort_order: sortOrder,
      is_active: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("audit_log").insert({
    action: "communication_competency_created",
    entity_type: "communication_competency",
    actor_user_id: user.id,
    metadata: {
      name,
      sort_order: sortOrder,
    },
  });

  revalidatePath("/communication-excellence/admin/competencies");
}

async function toggleCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const competencyId = String(formData.get("competency_id") || "");
  const nextState = formData.get("next_state") === "true";

  if (!competencyId) {
    throw new Error("Competency is required.");
  }

  const { error } = await supabase
    .from("communication_competencies")
    .update({
      is_active: nextState,
    })
    .eq("id", competencyId);

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("audit_log").insert({
    action: "communication_competency_updated",
    entity_type: "communication_competency",
    entity_id: competencyId,
    actor_user_id: user.id,
    metadata: {
      is_active: nextState,
    },
  });

  revalidatePath("/communication-excellence/admin/competencies");
}

type CompetencyRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export default async function CompetenciesAdminPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const { data, error } = await supabase
    .from("communication_competencies")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const competencies = (data ?? []) as CompetencyRow[];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Competencies"
      description="Manage Communication Excellence competencies and scoring categories."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Create competency
        </h2>

        <form action={createCompetency} className="mt-5 grid gap-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Name
            </label>

            <input
              name="name"
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Empathy"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Description
            </label>

            <textarea
              name="description"
              rows={3}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Describe what this competency measures..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Sort order
            </label>

            <input
              name="sort_order"
              type="number"
              defaultValue={0}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Create competency
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Existing competencies
        </h2>

        <div className="mt-5 space-y-3">
          {competencies.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              No competencies created yet.
            </div>
          ) : (
            competencies.map((competency) => (
              <div
                key={competency.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-base font-semibold text-slate-950">
                      {competency.name}
                    </div>

                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {competency.description || "No description"}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge
                        label={competency.is_active ? "Active" : "Inactive"}
                      />

                      <Badge label={`Sort: ${competency.sort_order}`} />
                    </div>
                  </div>

                  <form action={toggleCompetency}>
                    <input
                      type="hidden"
                      name="competency_id"
                      value={competency.id}
                    />

                    <input
                      type="hidden"
                      name="next_state"
                      value={String(!competency.is_active)}
                    />

                    <button
                      className={[
                        "rounded-2xl px-4 py-2 text-sm font-semibold",
                        competency.is_active
                          ? "bg-red-50 text-red-700"
                          : "bg-emerald-50 text-emerald-700",
                      ].join(" ")}
                    >
                      {competency.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
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