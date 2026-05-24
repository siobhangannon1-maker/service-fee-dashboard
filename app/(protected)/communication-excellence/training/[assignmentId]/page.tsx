import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ assignmentId: string }>;
};

async function submitQuiz(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const assignmentId = String(formData.get("assignment_id") || "");
  const moduleId = String(formData.get("module_id") || "");

  if (!assignmentId || !moduleId) throw new Error("Assignment and module are required.");

  const { data: assignment, error: assignmentError } = await supabase
    .from("communication_training_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("assigned_to_user_id", user.id)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found for this user.");
  }

  const { data: module, error: moduleError } = await supabase
    .from("communication_training_modules")
    .select("passing_score")
    .eq("id", moduleId)
    .single();

  if (moduleError || !module) throw new Error("Module not found.");

  const { data: questions, error: questionsError } = await supabase
    .from("communication_quiz_questions")
    .select("*")
    .eq("module_id", moduleId);

  if (questionsError) throw new Error(questionsError.message);

  const total = questions?.length ?? 0;
  if (total === 0) throw new Error("This module has no quiz questions.");

  let correct = 0;
  const answers: Record<string, string> = {};
  const feedback: Array<{
    question: string;
    selected: string;
    correct: string;
    isCorrect: boolean;
    explanation: string | null;
  }> = [];

  for (const question of questions ?? []) {
    const selected = String(formData.get(`question_${question.id}`) || "");
    const isCorrect = selected === question.correct_option;

    answers[question.id] = selected;
    if (isCorrect) correct += 1;

    feedback.push({
      question: question.question,
      selected,
      correct: question.correct_option,
      isCorrect,
      explanation: question.explanation,
    });
  }

  const score = Math.round((correct / total) * 100);
  const passed = score >= Number(module.passing_score || 80);

  const { error: attemptError } = await supabase
    .from("communication_training_attempts")
    .insert({
      assignment_id: assignmentId,
      module_id: moduleId,
      user_id: user.id,
      score,
      passed,
      answers,
      feedback: { items: feedback },
    });

  if (attemptError) throw new Error(attemptError.message);

  await supabase
    .from("communication_training_assignments")
    .update({
      status: passed ? "completed" : "attempted",
      completed_at: passed ? new Date().toISOString() : null,
    })
    .eq("id", assignmentId);

  if (passed) {
    const { data: linkedCompetencies } = await supabase
      .from("communication_module_competencies")
      .select("competency_id")
      .eq("module_id", moduleId);

    for (const row of linkedCompetencies ?? []) {
      await supabase.from("communication_skill_scores").upsert({
        user_id: user.id,
        competency_id: row.competency_id,
        score,
        evidence_count: 1,
        last_updated_at: new Date().toISOString(),
      });
    }
  }

  await supabase.from("audit_log").insert({
    action: passed
      ? "communication_training_completed"
      : "communication_training_attempted",
    entity_type: "communication_training_assignment",
    entity_id: assignmentId,
    metadata: {
      module_id: moduleId,
      score,
      passed,
      correct,
      total,
    },
    actor_user_id: user.id,
  });

  redirect(`/communication-excellence/training/${assignmentId}/result`);
}

export default async function AssignmentTrainingPage({ params }: PageProps) {
  const { assignmentId } = await params;
  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data: assignment, error } = await supabase
    .from("communication_training_assignments")
    .select(
      `
      id,
      status,
      due_date,
      module_id,
      communication_training_modules (
        id,
        title,
        description,
        content,
        passing_score
      )
      `
    )
    .eq("id", assignmentId)
    .eq("assigned_to_user_id", user.id)
    .single();

  if (error || !assignment) throw new Error("Assignment not found.");

  const module = assignment.communication_training_modules as any;

  const { data: questions } = await supabase
    .from("communication_quiz_questions")
    .select("*")
    .eq("module_id", module.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={module.title}
      description={module.description || "Complete this training module and quiz."}
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Training content</h2>
        <div className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-5 text-sm leading-6 text-slate-700">
          {module.content}
        </div>
      </section>

      <form action={submitQuiz} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <input type="hidden" name="module_id" value={module.id} />

        <h2 className="text-lg font-semibold text-slate-950">Quiz</h2>
        <p className="mt-1 text-sm text-slate-500">
          Passing score: {module.passing_score}%
        </p>

        <div className="mt-5 space-y-5">
          {(questions ?? []).map((question: any, index) => (
            <div key={question.id} className="rounded-2xl border border-slate-200 p-5">
              <div className="font-semibold text-slate-950">
                {index + 1}. {question.question}
              </div>

              <div className="mt-4 grid gap-3">
                <Option name={`question_${question.id}`} value="a" label={question.option_a} />
                <Option name={`question_${question.id}`} value="b" label={question.option_b} />
                {question.option_c ? (
                  <Option name={`question_${question.id}`} value="c" label={question.option_c} />
                ) : null}
                {question.option_d ? (
                  <Option name={`question_${question.id}`} value="d" label={question.option_d} />
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <button className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
          Submit quiz
        </button>
      </form>
    </PageLayout>
  );
}

function Option({
  name,
  value,
  label,
}: {
  name: string;
  value: string;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
      <input required type="radio" name={name} value={value} className="mt-1" />
      <span>{label}</span>
    </label>
  );
}