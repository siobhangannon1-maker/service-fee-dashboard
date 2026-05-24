import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ moduleId: string }>;
};

async function updateModule(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const moduleId = String(formData.get("module_id") || "");
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const passingScore = Number(formData.get("passing_score") || 80);
  const isPublished = formData.get("is_published") === "on";
  const isActive = formData.get("is_active") === "on";

  if (!moduleId || !title) throw new Error("Module ID and title are required.");

  const { error } = await supabase
    .from("communication_training_modules")
    .update({
      title,
      description,
      content,
      passing_score: passingScore,
      is_published: isPublished,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", moduleId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_module_updated",
    entity_type: "communication_training_module",
    entity_id: moduleId,
    metadata: { title, is_published: isPublished, is_active: isActive },
    actor_user_id: user.id,
  });

  revalidatePath(`/communication-excellence/admin/modules/${moduleId}`);
}

async function addQuestion(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);
  const moduleId = String(formData.get("module_id") || "");

  const question = String(formData.get("question") || "").trim();
  const optionA = String(formData.get("option_a") || "").trim();
  const optionB = String(formData.get("option_b") || "").trim();
  const optionC = String(formData.get("option_c") || "").trim();
  const optionD = String(formData.get("option_d") || "").trim();
  const correctOption = String(formData.get("correct_option") || "a");
  const explanation = String(formData.get("explanation") || "").trim();

  if (!moduleId || !question || !optionA || !optionB) {
    throw new Error("Module, question, option A and option B are required.");
  }

  const { error } = await supabase.from("communication_quiz_questions").insert({
    module_id: moduleId,
    question,
    option_a: optionA,
    option_b: optionB,
    option_c: optionC || null,
    option_d: optionD || null,
    correct_option: correctOption,
    explanation: explanation || null,
  });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_quiz_question_created",
    entity_type: "communication_training_module",
    entity_id: moduleId,
    metadata: { question },
    actor_user_id: user.id,
  });

  revalidatePath(`/communication-excellence/admin/modules/${moduleId}`);
}

async function deleteQuestion(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);
  const moduleId = String(formData.get("module_id") || "");
  const questionId = String(formData.get("question_id") || "");

  if (!moduleId || !questionId) throw new Error("Module and question are required.");

  const { error } = await supabase
    .from("communication_quiz_questions")
    .delete()
    .eq("id", questionId)
    .eq("module_id", moduleId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_quiz_question_deleted",
    entity_type: "communication_quiz_question",
    entity_id: questionId,
    metadata: { module_id: moduleId },
    actor_user_id: user.id,
  });

  revalidatePath(`/communication-excellence/admin/modules/${moduleId}`);
}

async function linkCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);
  const moduleId = String(formData.get("module_id") || "");
  const competencyId = String(formData.get("competency_id") || "");

  if (!moduleId || !competencyId) throw new Error("Module and competency are required.");

  const { error } = await supabase
    .from("communication_module_competencies")
    .upsert({
      module_id: moduleId,
      competency_id: competencyId,
      weight: 1,
    });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_module_competency_linked",
    entity_type: "communication_training_module",
    entity_id: moduleId,
    metadata: { competency_id: competencyId },
    actor_user_id: user.id,
  });

  revalidatePath(`/communication-excellence/admin/modules/${moduleId}`);
}

async function unlinkCompetency(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);
  const moduleId = String(formData.get("module_id") || "");
  const linkId = String(formData.get("link_id") || "");

  if (!moduleId || !linkId) throw new Error("Module and competency link are required.");

  const { error } = await supabase
    .from("communication_module_competencies")
    .delete()
    .eq("id", linkId)
    .eq("module_id", moduleId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_module_competency_unlinked",
    entity_type: "communication_training_module",
    entity_id: moduleId,
    metadata: { link_id: linkId },
    actor_user_id: user.id,
  });

  revalidatePath(`/communication-excellence/admin/modules/${moduleId}`);
}

export default async function ModuleDetailPage({ params }: PageProps) {
  const { moduleId } = await params;
  const { supabase } = await requireRole(["super_admin"]);

  const [moduleResult, questionsResult, competenciesResult, linkedResult] =
    await Promise.all([
      supabase
        .from("communication_training_modules")
        .select("*")
        .eq("id", moduleId)
        .single(),

      supabase
        .from("communication_quiz_questions")
        .select("*")
        .eq("module_id", moduleId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),

      supabase
        .from("communication_competencies")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),

      supabase
        .from("communication_module_competencies")
        .select("id, competency_id, communication_competencies(id, name)")
        .eq("module_id", moduleId),
    ]);

  if (moduleResult.error) throw new Error(moduleResult.error.message);

  const module = moduleResult.data;
  const questions = questionsResult.data ?? [];
  const competencies = competenciesResult.data ?? [];
  const linked = linkedResult.data ?? [];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={module.title}
      description="Edit module content, quiz questions and linked competencies."
    >
      <Link
        href="/communication-excellence/admin"
        className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        ← Back to admin
      </Link>

      <form
        action={updateModule}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <input type="hidden" name="module_id" value={moduleId} />

        <h2 className="text-lg font-semibold text-slate-950">Edit module</h2>

        <div className="mt-5 grid gap-4">
          <Field label="Title">
            <input
              name="title"
              defaultValue={module.title}
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              defaultValue={module.description || ""}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Training content">
            <textarea
              name="content"
              defaultValue={module.content || ""}
              rows={12}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Passing score">
            <input
              name="passing_score"
              type="number"
              defaultValue={module.passing_score || 80}
              min={0}
              max={100}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                name="is_published"
                type="checkbox"
                defaultChecked={Boolean(module.is_published)}
                className="h-4 w-4"
              />
              Published
            </label>

            <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
              <input
                name="is_active"
                type="checkbox"
                defaultChecked={Boolean(module.is_active)}
                className="h-4 w-4"
              />
              Active
            </label>
          </div>

          <button className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white sm:w-auto">
            Save module
          </button>
        </div>
      </form>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
                    <input type="hidden" name="module_id" value={moduleId} />
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
            <input type="hidden" name="module_id" value={moduleId} />

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
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Quiz questions
          </h2>

          <div className="mt-4 space-y-3">
            {questions.length === 0 ? (
              <EmptyState text="No quiz questions yet." />
            ) : (
              questions.map((question: any, index) => (
                <div
                  key={question.id}
                  className="rounded-2xl border border-slate-200 p-4"
                >
                  <div className="text-sm font-semibold text-slate-950">
                    {index + 1}. {question.question}
                  </div>

                  <div className="mt-2 text-xs text-slate-500">
                    Correct answer: {question.correct_option.toUpperCase()}
                  </div>

                  <form action={deleteQuestion} className="mt-3">
                    <input type="hidden" name="module_id" value={moduleId} />
                    <input type="hidden" name="question_id" value={question.id} />
                    <button className="text-xs font-semibold text-red-600">
                      Delete question
                    </button>
                  </form>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Add quiz question
        </h2>

        <form action={addQuestion} className="mt-5 grid gap-4">
          <input type="hidden" name="module_id" value={moduleId} />

          <textarea
            name="question"
            required
            rows={3}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Question"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <input
              name="option_a"
              required
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Option A"
            />

            <input
              name="option_b"
              required
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Option B"
            />

            <input
              name="option_c"
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Option C optional"
            />

            <input
              name="option_d"
              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Option D optional"
            />
          </div>

          <select
            name="correct_option"
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="a">A is correct</option>
            <option value="b">B is correct</option>
            <option value="c">C is correct</option>
            <option value="d">D is correct</option>
          </select>

          <textarea
            name="explanation"
            rows={3}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            placeholder="Explanation shown after completion"
          />

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Add question
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