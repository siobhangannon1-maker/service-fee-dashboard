import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ scenarioId: string }>;
};

async function startScenario(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const scenarioId = String(formData.get("scenario_id") || "");

  if (!scenarioId) {
    throw new Error("Scenario is required.");
  }

  const { data: scenario, error: scenarioError } = await supabase
    .from("communication_scenarios")
    .select("id, title, scenario_prompt")
    .eq("id", scenarioId)
    .single();

  if (scenarioError || !scenario) {
    throw new Error(scenarioError?.message || "Scenario not found.");
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("communication_scenario_attempts")
    .insert({
      scenario_id: scenarioId,
      user_id: user.id,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    throw new Error(
      attemptError?.message || "Could not create scenario attempt."
    );
  }

  const openingMessage =
    scenario.scenario_prompt?.trim() ||
    "Hi, I am feeling nervous and I have some questions. Can you help me?";

  const { error: messageError } = await supabase
    .from("communication_scenario_messages")
    .insert({
      attempt_id: attempt.id,
      role: "patient",
      speaker: "patient",
      content: openingMessage,
      message: openingMessage,
    });

  if (messageError) {
    throw new Error(
      `Could not create opening patient message: ${messageError.message}`
    );
  }

  await supabase.from("audit_log").insert({
    action: "communication_scenario_started",
    entity_type: "communication_scenario_attempt",
    entity_id: attempt.id,
    actor_user_id: user.id,
    metadata: {
      scenario_id: scenarioId,
      title: scenario.title,
    },
  });

  redirect(
    `/communication-excellence/scenarios/${scenarioId}/attempt/${attempt.id}`
  );
}

export default async function ScenarioStartPage({ params }: PageProps) {
  const { scenarioId } = await params;

  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data: scenario, error } = await supabase
    .from("communication_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .single();

  if (error || !scenario) {
    throw new Error(error?.message || "Scenario not found.");
  }

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={scenario.title}
      description={
        scenario.description || "Practise this patient communication scenario."
      }
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Scenario brief
        </h2>

        <div className="mt-4 grid gap-4">
          <InfoBlock title="Patient persona" text={scenario.patient_persona} />
          <InfoBlock title="Situation" text={scenario.scenario_prompt} />
        </div>

        <form action={startScenario} className="mt-6">
          <input type="hidden" name="scenario_id" value={scenarioId} />

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Start roleplay
          </button>
        </form>
      </section>
    </PageLayout>
  );
}

function InfoBlock({
  title,
  text,
}: {
  title: string;
  text: string | null;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-5">
      <div className="text-sm font-semibold text-slate-950">{title}</div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {text || "—"}
      </p>
    </div>
  );
}