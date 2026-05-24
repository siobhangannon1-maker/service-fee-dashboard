import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createScenario(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const category = String(formData.get("category") || "general").trim();
  const difficulty = String(formData.get("difficulty") || "beginner").trim();
  const estimatedMinutes = Number(formData.get("estimated_minutes") || 5);
  const patientPersona = String(formData.get("patient_persona") || "").trim();
  const scenarioPrompt = String(formData.get("scenario_prompt") || "").trim();
  const idealBehaviours = String(formData.get("ideal_behaviours") || "").trim();
  const escalationRules = String(formData.get("escalation_rules") || "").trim();
  const isPublished = formData.get("is_published") === "on";

  if (!title) throw new Error("Title is required.");

  const { data, error } = await supabase
    .from("communication_scenarios")
    .insert({
      title,
      description,
      category,
      difficulty,
      estimated_minutes: estimatedMinutes,
      patient_persona: patientPersona,
      scenario_prompt: scenarioPrompt,
      ideal_behaviours: idealBehaviours,
      escalation_rules: escalationRules,
      is_published: isPublished,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_created",
    entity_type: "communication_scenario",
    entity_id: data.id,
    actor_user_id: user.id,
    metadata: {
      title,
      category,
      difficulty,
      is_published: isPublished,
    },
  });

  redirect(`/communication-excellence/admin/scenarios/${data.id}`);
}

export default async function NewScenarioPage() {
  await requireRole(["super_admin"]);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="New Scenario"
      description="Create a text-based patient roleplay scenario."
    >
      <form
        action={createScenario}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-5">
          <Field label="Title">
            <input
              name="title"
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Nervous patient before surgery"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Short summary shown to staff"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Category">
              <select
                name="category"
                defaultValue="nervous_patients"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="nervous_patients">Nervous Patients</option>
                <option value="cost_conversations">Cost Conversations</option>
                <option value="complaints">Complaints</option>
                <option value="referrals">Referrals</option>
                <option value="emergencies">Emergencies</option>
                <option value="phone_skills">Phone Skills</option>
                <option value="surgical_communication">
                  Surgical Communication
                </option>
                <option value="general">General</option>
              </select>
            </Field>

            <Field label="Difficulty">
              <select
                name="difficulty"
                defaultValue="beginner"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </Field>

            <Field label="Estimated minutes">
              <input
                name="estimated_minutes"
                type="number"
                min={1}
                max={60}
                defaultValue={5}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />
            </Field>
          </div>

          <Field label="Patient persona">
            <textarea
              name="patient_persona"
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Anxious patient, worried about pain, has had a bad dental experience before..."
            />
          </Field>

          <Field label="Scenario prompt">
            <textarea
              name="scenario_prompt"
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: I am really nervous about this appointment. Can you explain what will happen?"
            />
          </Field>

          <Field label="Ideal behaviours">
            <textarea
              name="ideal_behaviours"
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Empathy, calm tone, explain next steps, do not overpromise..."
            />
          </Field>

          <Field label="Escalation rules">
            <textarea
              name="escalation_rules"
              rows={4}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="When should staff involve a clinician or practice manager?"
            />
          </Field>

          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input name="is_published" type="checkbox" className="h-4 w-4" />
            Publish immediately
          </label>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Create scenario
          </button>
        </div>
      </form>
    </PageLayout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      {children}
    </label>
  );
}