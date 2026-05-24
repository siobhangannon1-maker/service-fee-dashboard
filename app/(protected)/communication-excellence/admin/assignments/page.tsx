import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createAssignment(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const moduleId = String(formData.get("module_id") || "");
  const assignedToUserId = String(formData.get("assigned_to_user_id") || "");
  const dueDateRaw = String(formData.get("due_date") || "");

  if (!moduleId || !assignedToUserId) {
    throw new Error("Module and staff member are required.");
  }

  const { error } = await supabase
    .from("communication_training_assignments")
    .upsert({
      module_id: moduleId,
      assigned_to_user_id: assignedToUserId,
      assigned_by_user_id: user.id,
      due_date: dueDateRaw || null,
      status: "assigned",
    });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_training_assigned",
    entity_type: "communication_training_assignment",
    metadata: {
      module_id: moduleId,
      assigned_to_user_id: assignedToUserId,
      due_date: dueDateRaw || null,
    },
    actor_user_id: user.id,
  });

  redirect("/communication-excellence/admin/assignments");
}

export default async function AssignmentsPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const [modulesResult, profilesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("communication_training_modules")
      .select("id, title")
      .eq("is_active", true)
      .order("title"),

    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("full_name"),

    supabase
      .from("communication_training_assignments")
      .select("id, module_id, assigned_to_user_id, status, due_date, assigned_at, completed_at")
      .order("assigned_at", { ascending: false }),
  ]);

  const modules = modulesResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const assignments = assignmentsResult.data ?? [];

  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Training Assignments"
      description="Assign training modules to staff and audit completion."
    >
      <form
        action={createAssignment}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-slate-950">Assign module</h2>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <select
            name="module_id"
            required
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">Select module</option>
            {modules.map((module) => (
              <option key={module.id} value={module.id}>
                {module.title}
              </option>
            ))}
          </select>

          <select
            name="assigned_to_user_id"
            required
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">Select staff member</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name || profile.email} ({profile.role})
              </option>
            ))}
          </select>

          <input
            name="due_date"
            type="date"
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          />
        </div>

        <button className="mt-5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
          Assign training
        </button>
      </form>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Current assignments
        </h2>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Staff
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Module
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">
                  Due
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {assignments.map((assignment) => {
                const profile = profileById.get(assignment.assigned_to_user_id);
                const module = moduleById.get(assignment.module_id);

                return (
                  <tr key={assignment.id}>
                    <td className="px-4 py-3">
                      {profile?.full_name || profile?.email || "Unknown"}
                    </td>
                    <td className="px-4 py-3">{module?.title || "Unknown"}</td>
                    <td className="px-4 py-3">{assignment.status}</td>
                    <td className="px-4 py-3">{assignment.due_date || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </PageLayout>
  );
}