import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ scenarioId: string }>;
};

async function updateScenario(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const scenarioId = String(formData.get("scenario_id") || "");
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
  const isActive = formData.get("is_active") === "on";

  if (!scenarioId || !title) throw new Error("Scenario ID and title are required.");

  const { error } = await supabase
    .from("communication_scenarios")
    .update({
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
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scenarioId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_updated",
    entity_type: "communication_scenario",
    entity_id: scenarioId,
    actor_user_id: user.id,
    metadata: {
      title,
      category,
      difficulty,
      is_published: isPublished,
      is_active: isActive,
    },
  });

  revalidatePath(`/communication-excellence/admin/scenarios/${scenarioId}`);
}

async function linkCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const scenarioId = String(formData.get("scenario_id") || "");
  const competencyId = String(formData.get("competency_id") || "");

  if (!scenarioId || !competencyId) {
    throw new Error("Scenario and competency are required.");
  }

  const { error } = await supabase
    .from("communication_scenario_competencies")
    .upsert({
      scenario_id: scenarioId,
      competency_id: competencyId,
      weight: 1,
    });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_competency_linked",
    entity_type: "communication_scenario",
    entity_id: scenarioId,
    actor_user_id: user.id,
    metadata: { competency_id: competencyId },
  });

  revalidatePath(`/communication-excellence/admin/scenarios/${scenarioId}`);
}

async function unlinkCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const scenarioId = String(formData.get("scenario_id") || "");
  const linkId = String(formData.get("link_id") || "");

  if (!scenarioId || !linkId) throw new Error("Scenario and link are required.");

  const { error } = await supabase
    .from("communication_scenario_competencies")
    .delete()
    .eq("id", linkId)
    .eq("scenario_id", scenarioId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_competency_unlinked",
    entity_type: "communication_scenario",
    entity_id: scenarioId,
    actor_user_id: user.id,
    metadata: { link_id: linkId },
  });

  revalidatePath(`/communication-excellence/admin/scenarios/${scenarioId}`);
}

export default async function ScenarioEditPage({ params }: PageProps) {
  const { scenarioId } = await params;
  const { supabase } = await requireRole(["super_admin"]);

  const [scenarioResult, competenciesResult, linkedResult] = await Promise.all([
    supabase
      .from("communication_scenarios")
      .select("*")
      .eq("id", scenarioId)
      .single(),

    supabase
      .from("communication_competencies")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),

    supabase
      .from("communication_scenario_competencies")
      .select("id, competency_id, communication_competencies(id, name)")
      .eq("scenario_id", scenarioId),
  ]);

  if (scenarioResult.error) throw new Error(scenarioResult.error.message);

  const scenario = scenarioResult.data;
  const competencies = competenciesResult.data ?? [];
  const linked = linkedResult.data ?? [];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={scenario.title}
      description="Edit scenario details, category, difficulty and linked competencies."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/scenarios"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          ← Back to scenarios
        </Link>

        <Link
          href={`/communication-excellence/scenarios/${scenarioId}`}
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          Preview scenario
        </Link>
      </div>

      <form
        action={updateScenario}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <input type="hidden" name="scenario_id" value={scenarioId} />

        <div className="grid gap-5">
          <Field label="Title">
            <input
              name="title"
              defaultValue={scenario.title}
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              defaultValue={scenario.description || ""}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Category">
              <select
                name="category"
                defaultValue={scenario.category || "general"}
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
                defaultValue={scenario.difficulty || "beginner"}
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
                defaultValue={scenario.estimated_minutes || 5}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />
            </Field>
          </div>

          <Field label="Patient persona">
            <textarea
              name="patient_persona"
              defaultValue={scenario.patient_persona || ""}
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Scenario prompt">
            <textarea
              name="scenario_prompt"
              defaultValue={scenario.scenario_prompt || ""}
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Ideal behaviours">
            <textarea
              name="ideal_behaviours"
              defaultValue={scenario.ideal_behaviours || ""}
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Escalation rules">
            <textarea
              name="escalation_rules"
              defaultValue={scenario.escalation_rules || ""}
              rows={4}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                name="is_published"
                type="checkbox"
                defaultChecked={Boolean(scenario.is_published)}
                className="h-4 w-4"
              />
              Published
            </label>

            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                name="is_active"
                type="checkbox"
                defaultChecked={Boolean(scenario.is_active)}
                className="h-4 w-4"
              />
              Active
            </label>
          </div>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Save scenario
          </button>
        </div>
      </form>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Linked competencies
        </h2>

        <div className="mt-4 space-y-2">
          {linked.length === 0 ? (
            <EmptyState text="No competencies linked yet." />
          ) : (
            linked.map((row: any) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3"
              >
                <div className="text-sm font-semibold text-slate-700">
                  {row.communication_competencies?.name}
                </div>

                <form action={unlinkCompetency}>
                  <input type="hidden" name="scenario_id" value={scenarioId} />
                  <input type="hidden" name="link_id" value={row.id} />
                  <button className="text-xs font-semibold text-red-600">
                    Remove
                  </button>
                </form>
              </div>
            ))
          )}
        </div>

        <form action={linkCompetency} className="mt-5 grid gap-3">
          <input type="hidden" name="scenario_id" value={scenarioId} />

          <select
            name="competency_id"
            required
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">Select competency</option>
            {competencies.map((competency) => (
              <option key={competency.id} value={competency.id}>
                {competency.name}
              </option>
            ))}
          </select>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Link competency
          </button>
        </form>
      </section>
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
      {text}
    </div>
  );
}