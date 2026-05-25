import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createScenario(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const payload = buildScenarioPayload(formData);

  if (!payload.title || !payload.opening_message) {
    throw new Error("Title and opening patient message are required.");
  }

  const { data, error } = await supabase
    .from("communication_scenarios")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_scenario_library_created",
    entity_type: "communication_scenario",
    entity_id: data.id,
    actor_user_id: user.id,
    metadata: {
      title: payload.title,
      category: payload.category,
      difficulty: payload.difficulty,
    },
  });

  redirect(`/communication-excellence/admin/scenario-library/${data.id}`);
}

export default async function NewScenarioPage() {
  await requireRole(["super_admin", "admin", "practice_manager"]);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Create Scenario"
      description="Paste a complete scenario into the library for staff AI roleplay."
    >
      <form
        action={createScenario}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ScenarioFields />

        <button className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
          Create scenario
        </button>
      </form>
    </PageLayout>
  );
}

function ScenarioFields() {
  return (
    <div className="grid gap-5">
      <section className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <input
            name="title"
            required
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Referred Patient First Contact"
          />
        </Field>

        <Field label="Category">
          <select
            name="category"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            defaultValue="new_patient_conversion"
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
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            defaultValue="beginner"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </Field>

        <Field label="Active">
          <select
            name="is_active"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            defaultValue="true"
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
        placeholder="The patient has been referred by their dentist but is unsure why they need to attend..."
      />

      <TextArea
        label="Opening patient message"
        name="opening_message"
        rows={3}
        required
        placeholder="Hi, I got a text saying I was referred, but I’m not really sure why I need to come in."
      />

      <TextArea
        label="Scenario goal"
        name="scenario_goal"
        rows={4}
        placeholder="Explain the purpose of the consultation, reduce uncertainty, build trust, and guide the patient toward booking."
      />

      <TextArea
        label="Ethical conversion goal"
        name="ethical_conversion_goal"
        rows={4}
        placeholder="Help the patient feel informed and comfortable taking the next step without pressure."
      />

      <TextArea
        label="Success criteria"
        name="success_criteria"
        rows={7}
        placeholder={"- Introduces the practice professionally\n- Explains referral clearly\n- Uses guided booking language"}
      />

      <TextArea
        label="Escalation triggers"
        name="escalation_triggers"
        rows={5}
        placeholder={"- Severe pain\n- Patient requests diagnosis\n- Patient becomes upset or confused"}
      />

      <TextArea
        label="Ideal phrases"
        name="ideal_phrases"
        rows={7}
        placeholder={"- The consultation is designed to give you clarity and answer your questions."}
      />

      <TextArea
        label="Poor phrases"
        name="poor_phrases"
        rows={7}
        placeholder={"- I don’t know, your dentist just sent it."}
      />

      <TextArea
        label="AI scoring focus"
        name="ai_scoring_focus"
        rows={5}
        placeholder={"- Clarity\n- Confidence\n- Guided booking\n- Ethical conversion"}
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
    patient_persona:
      String(formData.get("patient_persona") || "").trim() || null,
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
  placeholder,
  required = false,
}: {
  label: string;
  name: string;
  rows: number;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <textarea
        name={name}
        rows={rows}
        required={required}
        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6"
        placeholder={placeholder}
      />
    </Field>
  );
}