import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createTemplate(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const competencyFocus = String(
    formData.get("competency_focus") || ""
  ).trim();

  const content = String(formData.get("content") || "").trim();

  if (!title || !content) {
    throw new Error("Title and content are required.");
  }

  const { error } = await supabase
    .from("communication_microlearning_templates")
    .insert({
      title,
      description,
      competency_focus: competencyFocus,
      content,
      created_by: user.id,
    });

  if (error) throw new Error(error.message);

  revalidatePath(
    "/communication-excellence/admin/microlearning-templates"
  );
}

export default async function MicrolearningTemplatesPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const { data, error } = await supabase
    .from("communication_microlearning_templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Microlearning Templates"
      description="Reusable AI coaching remediation templates."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <form action={createTemplate} className="grid gap-5">
          <Field label="Title">
            <input
              name="title"
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Escalation communication"
            />
          </Field>

          <Field label="Competency focus">
            <input
              name="competency_focus"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: escalation"
            />
          </Field>

          <Field label="Description">
            <textarea
              name="description"
              rows={3}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Content">
            <textarea
              name="content"
              rows={8}
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Create template
          </button>
        </form>
      </section>

      <section className="space-y-3">
        {data?.map((template: any) => (
          <div
            key={template.id}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="font-semibold text-slate-950">
              {template.title}
            </div>

            <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {template.competency_focus}
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              {template.description}
            </p>

            <div className="mt-4 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {template.content}
            </div>
          </div>
        ))}
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
      <div className="mb-2 text-sm font-medium text-slate-700">
        {label}
      </div>
      {children}
    </label>
  );
}