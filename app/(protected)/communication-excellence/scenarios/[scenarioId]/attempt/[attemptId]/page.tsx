import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";
import {
  generatePatientReply,
  scoreScenario,
} from "@/lib/communication-excellence/scenario-ai";
import { generateCoachingFeedback } from "@/lib/communication-excellence/coaching-ai";

type PageProps = {
  params: Promise<{
    scenarioId: string;
    attemptId: string;
  }>;
};

async function sendScenarioMessage(formData: FormData) {
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
  const attemptId = String(formData.get("attempt_id") || "");
  const staffMessage = String(formData.get("message") || "").trim();

  if (!scenarioId || !attemptId || !staffMessage) {
    throw new Error("Scenario, attempt and message are required.");
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("communication_scenario_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("scenario_id", scenarioId)
    .eq("user_id", user.id)
    .single();

  if (attemptError || !attempt) throw new Error("Attempt not found.");

  if (attempt.status === "completed") {
    redirect(`/communication-excellence/scenarios/${scenarioId}/attempt/${attemptId}`);
  }

  const { error: insertStaffError } = await supabase
    .from("communication_scenario_messages")
    .insert({
      attempt_id: attemptId,
      role: "staff",
      speaker: "staff",
      content: staffMessage,
      message: staffMessage,
    });

  if (insertStaffError) throw new Error(insertStaffError.message);

  const { data: scenario, error: scenarioError } = await supabase
    .from("communication_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .single();

  if (scenarioError || !scenario) throw new Error("Scenario not found.");

  const { data: messages, error: messagesError } = await supabase
    .from("communication_scenario_messages")
    .select("role, content")
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });

  if (messagesError) throw new Error(messagesError.message);

  const safeMessages =
    (messages ?? []).map((row) => ({
      role: row.role as "patient" | "staff" | "system",
      content: row.content,
    })) ?? [];

  const patientReply = await generatePatientReply({
    scenarioTitle: scenario.title || "",
    patientPersona: scenario.patient_persona || "",
    scenarioPrompt: scenario.scenario_prompt || "",
    idealBehaviours: scenario.ideal_behaviours || "",
    escalationRules: scenario.escalation_rules || "",
    messages: safeMessages,
    practiceRules: await getPracticeRules(supabase),
  });

  const { error: patientReplyError } = await supabase
    .from("communication_scenario_messages")
    .insert({
      attempt_id: attemptId,
      role: "patient",
      speaker: "patient",
      content: patientReply,
      message: patientReply,
    });

  if (patientReplyError) throw new Error(patientReplyError.message);

  revalidatePath(`/communication-excellence/scenarios/${scenarioId}/attempt/${attemptId}`);
}

async function finishScenario(formData: FormData) {
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
  const attemptId = String(formData.get("attempt_id") || "");

  if (!scenarioId || !attemptId) {
    throw new Error("Scenario and attempt are required.");
  }

  const [scenarioResult, messagesResult, competenciesResult] = await Promise.all([
    supabase.from("communication_scenarios").select("*").eq("id", scenarioId).single(),

    supabase
      .from("communication_scenario_messages")
      .select("role, content")
      .eq("attempt_id", attemptId)
      .order("created_at", { ascending: true }),

    supabase
      .from("communication_scenario_competencies")
      .select("competency_id")
      .eq("scenario_id", scenarioId),
  ]);

  if (scenarioResult.error) throw new Error(scenarioResult.error.message);
  if (messagesResult.error) throw new Error(messagesResult.error.message);

  const scenario = scenarioResult.data;

  const messages =
    (messagesResult.data ?? []).map((row) => ({
      role: row.role as "patient" | "staff" | "system",
      content: row.content,
    })) ?? [];

  const scoring = await scoreScenario({
    scenarioTitle: scenario.title || "",
    patientPersona: scenario.patient_persona || "",
    idealBehaviours: scenario.ideal_behaviours || "",
    escalationRules: scenario.escalation_rules || "",
    messages,
    practiceRules: await getPracticeRules(supabase),
  });

  const coaching = await generateCoachingFeedback({
    scenarioTitle: scenario.title || "",
    score: scoring.score,
    empathyScore: scoring.empathy_score,
    clarityScore: scoring.clarity_score,
    professionalismScore: scoring.professionalism_score,
    escalationScore: scoring.escalation_score,
    summary: scoring.summary,
    strengths: scoring.strengths,
    improvements: scoring.improvements,
  });

  const { error: updateError } = await supabase
    .from("communication_scenario_attempts")
    .update({
      status: "completed",
      score: scoring.score,
      feedback: scoring,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId);

  if (updateError) throw new Error(updateError.message);

  await supabase.from("communication_coaching_feedback").insert({
    user_id: user.id,
    scenario_attempt_id: attemptId,
    overall_summary: coaching.overall_summary,
    strengths: coaching.strengths,
    improvement_areas: coaching.improvement_areas,
    recommended_focus: coaching.recommended_focus,
  });

  for (const competency of competenciesResult.data ?? []) {
  await supabase.from("communication_skill_scores").upsert({
    user_id: user.id,
    competency_id: competency.competency_id,
    score: scoring.score,
    evidence_count: 1,
    last_updated_at: new Date().toISOString(),
  });

  await supabase.from("communication_skill_score_history").insert({
    user_id: user.id,
    competency_id: competency.competency_id,

    source_type: "scenario",
    source_id: attemptId,

    score: scoring.score,

    metadata: {
      scenario_id: scenarioId,
      scenario_title: scenario.title,
      empathy_score: scoring.empathy_score,
      clarity_score: scoring.clarity_score,
      professionalism_score: scoring.professionalism_score,
      escalation_score: scoring.escalation_score,
    },
  });
}

  if (scoring.score < 80) {
    await supabase.from("communication_microlearning").insert({
      user_id: user.id,
      competency_id: competenciesResult.data?.[0]?.competency_id ?? null,
      title: `Scenario review: ${scenario.title}`,
      description: "Review the feedback and practise this scenario again.",
      status: "assigned",
      assigned_reason: `Scenario score ${scoring.score}% was below target.`,
      due_date: getDateDaysFromNow(7),
    });
  }

  await autoAssignMicrolearning({
    supabase,
    userId: user.id,
    coaching,
  });

  await supabase.from("audit_log").insert({
    action: "communication_scenario_completed",
    entity_type: "communication_scenario_attempt",
    entity_id: attemptId,
    actor_user_id: user.id,
    metadata: {
      scenario_id: scenarioId,
      score: scoring.score,
      empathy_score: scoring.empathy_score,
      clarity_score: scoring.clarity_score,
      professionalism_score: scoring.professionalism_score,
      escalation_score: scoring.escalation_score,
      recommended_focus: coaching.recommended_focus,
    },
  });

  revalidatePath(`/communication-excellence/scenarios/${scenarioId}/attempt/${attemptId}`);
}

export default async function ScenarioAttemptPage({ params }: PageProps) {
  const { scenarioId, attemptId } = await params;

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const [scenarioResult, attemptResult, messagesResult, coachingResult] =
    await Promise.all([
      supabase.from("communication_scenarios").select("*").eq("id", scenarioId).single(),

      supabase
        .from("communication_scenario_attempts")
        .select("*")
        .eq("id", attemptId)
        .eq("user_id", user.id)
        .single(),

      supabase
        .from("communication_scenario_messages")
        .select("*")
        .eq("attempt_id", attemptId)
        .order("created_at", { ascending: true }),

      supabase
        .from("communication_coaching_feedback")
        .select("*")
        .eq("scenario_attempt_id", attemptId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (scenarioResult.error) throw new Error(scenarioResult.error.message);
  if (attemptResult.error) throw new Error(attemptResult.error.message);
  if (messagesResult.error) throw new Error(messagesResult.error.message);

  const scenario = scenarioResult.data;
  const attempt = attemptResult.data;
  const messages = messagesResult.data ?? [];
  const completed = attempt.status === "completed";
  const feedback = attempt.feedback as any;
  const coaching = coachingResult.data as any | null;

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={scenario.title}
      description="Practice patient communication scenarios."
    >
      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Scenario Guide</h2>

          <InfoBlock title="Patient Persona" text={scenario.patient_persona} />
          <InfoBlock title="Ideal Behaviours" text={scenario.ideal_behaviours} />
          <InfoBlock title="Escalation Rules" text={scenario.escalation_rules} />

          {completed ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900">
              Final score:
              <span className="ml-2 font-semibold">{attempt.score}%</span>
            </div>
          ) : null}
        </aside>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Roleplay Chat</h2>

          <div className="mt-5 space-y-3">
            {messages.map((message: any) => (
              <div
                key={message.id}
                className={[
                  "rounded-2xl p-4 text-sm leading-6",
                  message.role === "staff"
                    ? "ml-auto max-w-[85%] bg-slate-950 text-white"
                    : "mr-auto max-w-[85%] bg-slate-100 text-slate-800",
                ].join(" ")}
              >
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                  {message.role === "staff" ? "You" : "Patient"}
                </div>
                {message.content}
              </div>
            ))}
          </div>

          {!completed ? (
            <>
              <form action={sendScenarioMessage} className="mt-6 grid gap-3">
                <input type="hidden" name="scenario_id" value={scenarioId} />
                <input type="hidden" name="attempt_id" value={attemptId} />

                <textarea
                  name="message"
                  required
                  rows={4}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  placeholder="Type your response..."
                />

                <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
                  Send Response
                </button>
              </form>

              <form action={finishScenario} className="mt-3">
                <input type="hidden" name="scenario_id" value={scenarioId} />
                <input type="hidden" name="attempt_id" value={attemptId} />

                <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                  Finish & Score Scenario
                </button>
              </form>
            </>
          ) : (
            <>
              <FeedbackBlock feedback={feedback} />
              <CoachingBlock coaching={coaching} />
            </>
          )}
        </section>
      </section>
    </PageLayout>
  );
}

function InfoBlock({ title, text }: { title: string; text: string | null }) {
  return (
    <div className="mt-4 rounded-2xl bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {text || "—"}
      </p>
    </div>
  );
}

function FeedbackBlock({ feedback }: { feedback: any }) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <h3 className="font-semibold text-slate-950">Scenario Feedback</h3>

      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <ScoreCard title="Empathy" value={feedback?.empathy_score} />
        <ScoreCard title="Clarity" value={feedback?.clarity_score} />
        <ScoreCard title="Professionalism" value={feedback?.professionalism_score} />
        <ScoreCard title="Escalation" value={feedback?.escalation_score} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <FeedbackList title="Strengths" items={feedback?.strengths ?? []} />
        <FeedbackList title="Improvements" items={feedback?.improvements ?? []} />
      </div>

      {feedback?.summary ? (
        <p className="mt-5 text-sm leading-6 text-slate-600">
          {feedback.summary}
        </p>
      ) : null}
    </div>
  );
}

function CoachingBlock({ coaching }: { coaching: any | null }) {
  if (!coaching) return null;

  return (
    <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <h3 className="font-semibold text-slate-950">AI Coaching Plan</h3>

      <p className="mt-3 text-sm leading-6 text-slate-700">
        {coaching.overall_summary}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <CoachingList title="Strengths" items={coaching.strengths ?? []} />
        <CoachingList
          title="Improvements"
          items={coaching.improvement_areas ?? []}
        />
        <CoachingList
          title="Recommended Focus"
          items={coaching.recommended_focus ?? []}
        />
      </div>
    </div>
  );
}

function ScoreCard({ title, value }: { title: string; value: number | undefined }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">
        {value ?? "—"}%
      </div>
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
        {items.length === 0 ? (
          <li>No feedback recorded.</li>
        ) : (
          items.map((item) => <li key={item}>{item}</li>)
        )}
      </ul>
    </div>
  );
}

function CoachingList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-blue-100">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length === 0 ? (
          <li>No items.</li>
        ) : (
          items.map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </div>
  );
}

function getDateDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getPracticeRules(supabase: any) {
  const { data, error } = await supabase
    .from("communication_practice_rules")
    .select("title, category, content")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to load communication practice rules:", error.message);
    return [];
  }

  return data ?? [];
}

async function autoAssignMicrolearning({
  supabase,
  userId,
  coaching,
}: {
  supabase: any;
  userId: string;
  coaching: {
    recommended_focus: string[];
  };
}) {
  const focuses = coaching.recommended_focus ?? [];

  if (focuses.length === 0) return;

  const { data: templates, error } = await supabase
    .from("communication_microlearning_templates")
    .select("*")
    .eq("is_active", true);

  if (error || !templates) {
    console.error(error);
    return;
  }

  for (const focus of focuses) {
    const focusLower = String(focus).toLowerCase();

    const template = templates.find((item: any) => {
      const templateFocus = String(item.competency_focus || "").toLowerCase();
      const title = String(item.title || "").toLowerCase();
      const description = String(item.description || "").toLowerCase();

      return (
        templateFocus.includes(focusLower) ||
        focusLower.includes(templateFocus) ||
        title.includes(focusLower) ||
        description.includes(focusLower)
      );
    });

    if (!template) continue;

    await supabase.from("communication_microlearning").insert({
      user_id: userId,
      title: template.title,
      description: [template.description, template.content]
        .filter(Boolean)
        .join("\n\n"),
      assigned_reason: `Automatically assigned after scenario coaching feedback: ${focus}`,
      status: "assigned",
      due_date: getDateDaysFromNow(7),
    });
  }
}