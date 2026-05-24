import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

async function markMicrolearningComplete(formData: FormData) {
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

  if (!itemId) throw new Error("Microlearning item is required.");

  const { error } = await supabase
    .from("communication_microlearning")
    .update({
      status: "completed",
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
    metadata: {},
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
      created_at,
      completed_at,
      communication_competencies (
        name
      )
      `
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const items = data ?? [];
  const openItems = items.filter((item) => item.status !== "completed");
  const completedItems = items.filter((item) => item.status === "completed");

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Microlearning"
      description="Short personalised learning tasks based on your training results."
    >
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Open Tasks" value={String(openItems.length)} />
        <MetricCard title="Completed" value={String(completedItems.length)} />
        <MetricCard title="Total Assigned" value={String(items.length)} />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Open microlearning</h2>

        <div className="mt-5 space-y-3">
          {openItems.length === 0 ? (
            <EmptyState text="No open microlearning tasks." />
          ) : (
            openItems.map((item: any) => (
              <MicrolearningCard key={item.id} item={item} showButton />
            ))
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Completed</h2>

        <div className="mt-5 space-y-3">
          {completedItems.length === 0 ? (
            <EmptyState text="No completed microlearning yet." />
          ) : (
            completedItems.map((item: any) => (
              <MicrolearningCard key={item.id} item={item} />
            ))
          )}
        </div>
      </section>
    </PageLayout>
  );
}

function MicrolearningCard({
  item,
  showButton = false,
}: {
  item: any;
  showButton?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="font-semibold text-slate-950">{item.title}</div>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            {item.description}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge label={item.status} />

            {item.communication_competencies?.name ? (
              <Badge label={item.communication_competencies.name} neutral />
            ) : null}

            {item.due_date ? <Badge label={`Due: ${item.due_date}`} neutral /> : null}
          </div>

          {item.assigned_reason ? (
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Reason: {item.assigned_reason}
            </p>
          ) : null}
        </div>

        {showButton ? (
          <form action={markMicrolearningComplete}>
            <input type="hidden" name="item_id" value={item.id} />
            <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              Mark complete
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
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

function Badge({ label, neutral = false }: { label: string; neutral?: boolean }) {
  return (
    <span
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold capitalize ring-1",
        neutral
          ? "bg-slate-100 text-slate-600 ring-slate-200"
          : "bg-blue-50 text-blue-700 ring-blue-200",
      ].join(" ")}
    >
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