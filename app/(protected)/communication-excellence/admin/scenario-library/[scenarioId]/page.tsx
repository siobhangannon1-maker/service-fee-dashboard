import { revalidatePath } from "next/cache";
import Link from "next/link";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ scenarioId: string }>;
};

async function updateScenario(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const scenarioId = String(formData.get("scenario_id") || "");
  const payload = buildScenarioPayload(formData);

  if (!scenarioId || !payload.title || !payload.opening_message) {
    throw new Error("Scenario, title and opening message are required.");
  }

  const { error } = await supabase
    .from("communication_scenarios")
    .update(payload)
    .eq("id", scenarioId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_library_updated",
    entity_type: "communication_scenario",
    entity_id: scenarioId,
    actor_user_id: user.id,
    metadata: {
      title: payload.title,
      category: payload.category,
      difficulty: payload.difficulty,
      is_active: payload.is_active,
    },
  });

  revalidatePath(`/communication-excellence/admin/scenario-library/${scenarioId}`);
  revalidatePath("/communication-excellence/admin/scenario-library");
  revalidatePath("/communication-excellence/scenarios");
}

export default async function ScenarioEditPage({ params }: PageProps) {
  const { scenarioId } = await params;

  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .single();

  if (error) throw new Error(error.message);

  const scenario = data as any;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Edit Scenario"
      description="Update scenario content, scoring goals and patient roleplay instructions."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/scenario-library"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          ← Back to scenario library
        </Link>

        <Link
          href="/communication-excellence/scenarios"
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          View learner scenarios
        </Link>
      </div>

      <form
        action={updateScenario}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <input type="hidden" name="scenario_id" value={scenario.id} />

        <ScenarioFields scenario={scenario} />

        <button className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
          Save scenario
        </button>
      </form>
    </PageLayout>
  );
}

function ScenarioFields({ scenario }: { scenario: any }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <input
            name="title"
            required
            defaultValue={scenario.title || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          />
        </Field>

        <Field label="Category">
          <select
            name="category"
            defaultValue={scenario.category || "general"}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="new_patient_conversion">New Patient Conversion</option>
            <option value="managing_nervous_patients">
              Managing Nervous Patients
            </option>
            <option value="retention_objection_handling">
              Retention / Objection Handling
            </option>
            <option value="treatment_cost_conversations">
              Treatment Cost Conversations
            </option>
            <option value="handling_upset_patients">
              Handling Upset Patients
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

        <Field label="Active">
          <select
            name="is_active"
            defaultValue={scenario.is_active ? "true" : "false"}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Field>
      </section>

      <TextArea
        label="Patient persona"
        name="patient_persona"
        rows={5}
        defaultValue={scenario.patient_persona || ""}
      />

      <TextArea
        label="Opening patient message"
        name="opening_message"
        rows={3}
        required
        defaultValue={scenario.opening_message || ""}
      />

      <TextArea
        label="Scenario goal"
        name="scenario_goal"
        rows={4}
        defaultValue={scenario.scenario_goal || ""}
      />

      <TextArea
        label="Ethical conversion goal"
        name="ethical_conversion_goal"
        rows={4}
        defaultValue={scenario.ethical_conversion_goal || ""}
      />

      <TextArea
        label="Success criteria"
        name="success_criteria"
        rows={7}
        defaultValue={scenario.success_criteria || ""}
      />

      <TextArea
        label="Escalation triggers"
        name="escalation_triggers"
        rows={5}
        defaultValue={scenario.escalation_triggers || ""}
      />

      <TextArea
        label="Ideal phrases"
        name="ideal_phrases"
        rows={7}
        defaultValue={scenario.ideal_phrases || ""}
      />

      <TextArea
        label="Poor phrases"
        name="poor_phrases"
        rows={7}
        defaultValue={scenario.poor_phrases || ""}
      />

      <TextArea
        label="AI scoring focus"
        name="ai_scoring_focus"
        rows={5}
        defaultValue={scenario.ai_scoring_focus || ""}
      />
    </div>
  );
}

function buildScenarioPayload(formData: FormData) {
  return {
    title: String(formData.get("title") || "").trim(),
    category: String(formData.get("category") || "general").trim(),
    difficulty: String(formData.get("difficulty") || "beginner").trim(),
    opening_message: String(formData.get("opening_message") || "").trim(),
    patient_persona: String(formData.get("patient_persona") || "").trim() || null,
    scenario_goal: String(formData.get("scenario_goal") || "").trim() || null,
    ethical_conversion_goal:
      String(formData.get("ethical_conversion_goal") || "").trim() || null,
    success_criteria:
      String(formData.get("success_criteria") || "").trim() || null,
    escalation_triggers:
      String(formData.get("escalation_triggers") || "").trim() || null,
    ideal_phrases: String(formData.get("ideal_phrases") || "").trim() || null,
    poor_phrases: String(formData.get("poor_phrases") || "").trim() || null,
    ai_scoring_focus:
      String(formData.get("ai_scoring_focus") || "").trim() || null,
    is_active: String(formData.get("is_active") || "true") === "true",
  };
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

function TextArea({
  label,
  name,
  rows,
  defaultValue,
  required = false,
}: {
  label: string;
  name: string;
  rows: number;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <textarea
        name={name}
        rows={rows}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6"
      />
    </Field>
  );
}