import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{
    scenarioId: string;
  }>;
};

export default async function StartVoiceScenarioPage({ params }: PageProps) {
  const { scenarioId } = await params;

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data: scenario, error: scenarioError } = await supabase
    .from("communication_scenarios")
    .select("id, title, opening_message")
    .eq("id", scenarioId)
    .maybeSingle();

  if (scenarioError) {
    throw new Error(`Scenario lookup failed: ${scenarioError.message}`);
  }

  if (!scenario) {
    throw new Error(`No scenario found for ID: ${scenarioId}`);
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("communication_voice_roleplay_attempts")
    .insert({
      scenario_id: scenarioId,
      user_id: user.id,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    throw new Error(
      attemptError?.message || "Could not create voice roleplay attempt."
    );
  }

  const openingMessage =
    scenario.opening_message ||
    "Hi, I am feeling nervous and I have some questions. Can you help me?";

  const { error: messageError } = await supabase
    .from("communication_voice_roleplay_messages")
    .insert({
      attempt_id: attempt.id,
      speaker: "patient",
      message: openingMessage,
    });

  if (messageError) {
    throw new Error(`Opening message failed: ${messageError.message}`);
  }

  redirect(
    `/communication-excellence/scenarios/${scenarioId}/voice/${attempt.id}`
  );
}