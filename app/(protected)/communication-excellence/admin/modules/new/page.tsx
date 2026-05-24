import { redirect } from "next/navigation";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function createModule(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const passingScore = Number(formData.get("passing_score") || 80);
  const isPublished = formData.get("is_published") === "on";

  if (!title) {
    throw new Error("Title is required.");
  }

  const { error } = await supabase.from("communication_training_modules").insert({
    title,
    description,
    content,
    passing_score: passingScore,
    is_published: isPublished,
    is_active: true,
    created_by: user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  await supabase.from("audit_log").insert({
    action: "communication_module_created",
    entity_type: "communication_training_module",
    metadata: {
      title,
      is_published: isPublished,
    },
    actor_user_id: user.id,
  });

  redirect("/communication-excellence/admin");
}

export default async function NewCommunicationModulePage() {
  await requireRole(["super_admin"]);

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="New Training Module"
      description="Create a practice-specific communication training module."
    >
      <form
        action={createModule}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-5">
          <Field label="Title">
            <input
              name="title"
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: New patient phone enquiry"
            />
          </Field>

          <Field label="Description">
            <input
              name="description"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Short summary for staff"
            />
          </Field>

          <Field label="Training content">
            <textarea
              name="content"
              rows={12}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Add practice-specific training content here..."
            />
          </Field>

          <Field label="Passing score">
            <input
              name="passing_score"
              type="number"
              defaultValue={80}
              min={0}
              max={100}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <input name="is_published" type="checkbox" className="h-4 w-4" />
            Publish immediately
          </label>

          <button className="inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white sm:w-auto">
            Create module
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