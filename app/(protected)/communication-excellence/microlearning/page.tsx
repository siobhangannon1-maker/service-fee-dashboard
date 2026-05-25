import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type MicrolearningRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigned_reason: string | null;
  due_date: string | null;
  reflection_notes: string | null;
  completed_at: string | null;
  created_at: string;
  communication_competencies:
    | {
        name: string;
      }[]
    | null;
};

async function completeMicrolearning(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const itemId = String(formData.get("item_id") || "");
  const reflectionNotes = String(formData.get("reflection_notes") || "").trim();

  if (!itemId) throw new Error("Microlearning item is required.");

  const { error } = await supabase
    .from("communication_microlearning")
    .update({
      status: "completed",
      reflection_notes: reflectionNotes || null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_microlearning_completed",
    entity_type: "communication_microlearning",
    entity_id: itemId,
    actor_user_id: user.id,
    metadata: {
      reflection_notes: reflectionNotes || null,
    },
  });

  revalidatePath("/communication-excellence/microlearning");
}

export default async function MicrolearningPage() {
  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
    "billing_staff",
    "typist",
    "provider_readonly",
  ]);

  const { data, error } = await supabase
    .from("communication_microlearning")
    .select(
      `
      id,
      title,
      description,
      status,
      assigned_reason,
      due_date,
      reflection_notes,
      completed_at,
      created_at,
      communication_competencies (
        name
      )
      `
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const items = (data ?? []) as MicrolearningRow[];
  const openItems = items.filter((item) => item.status !== "completed");
  const completedItems = items.filter((item) => item.status === "completed");

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Microlearning"
      description="Short personalised learning tasks based on your training and scenario results."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Open Tasks" value={String(openItems.length)} />
        <MetricCard title="Completed" value={String(completedItems.length)} />
        <MetricCard title="Total Assigned" value={String(items.length)} />
      </section>

      <Panel title="Open microlearning">
        {openItems.length === 0 ? (
          <EmptyState text="No open microlearning tasks." />
        ) : (
          <div className="space-y-4">
            {openItems.map((item) => (
              <MicrolearningCard key={item.id} item={item} showCompleteForm />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Completed microlearning">
        {completedItems.length === 0 ? (
          <EmptyState text="No completed microlearning yet." />
        ) : (
          <div className="space-y-4">
            {completedItems.map((item) => (
              <MicrolearningCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </Panel>
    </PageLayout>
  );
}

function MicrolearningCard({
  item,
  showCompleteForm = false,
}: {
  item: MicrolearningRow;
  showCompleteForm?: boolean;
}) {
  const competency = getFirstRelatedRow(item.communication_competencies);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-slate-950">{item.title}</div>

          {item.description ? (
            <div className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {item.description}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <StatusBadge label={item.status} />

            {competency?.name ? <Badge label={competency.name} /> : null}

            {item.due_date ? <Badge label={`Due: ${item.due_date}`} /> : null}

            {item.completed_at ? (
              <Badge label={`Completed: ${formatDate(item.completed_at)}`} />
            ) : null}
          </div>

          {item.assigned_reason ? (
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Reason: {item.assigned_reason}
            </p>
          ) : null}

          {item.reflection_notes ? (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                Reflection notes
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {item.reflection_notes}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {showCompleteForm ? (
        <form action={completeMicrolearning} className="mt-5 grid gap-3">
          <input type="hidden" name="item_id" value={item.id} />

          <label className="block">
            <div className="mb-2 text-sm font-medium text-slate-700">
              Reflection notes
            </div>

            <textarea
              name="reflection_notes"
              rows={4}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="What did you learn? What will you try differently next time?"
            />
          </label>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Mark complete
          </button>
        </form>
      ) : null}
    </div>
  );
}

function getFirstRelatedRow<T>(value: T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StatusBadge({ label }: { label: string }) {
  const styles =
    label === "completed"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-blue-50 text-blue-700 ring-blue-200";

  return (
    <span
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold capitalize ring-1",
        styles,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}