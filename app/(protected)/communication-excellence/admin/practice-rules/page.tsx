import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type RuleRow = {
  id: string;
  title: string;
  category: string;
  content: string;
  is_active: boolean;
  created_at: string;
};

async function createRule(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const title = String(formData.get("title") || "").trim();
  const category = String(formData.get("category") || "general").trim();
  const content = String(formData.get("content") || "").trim();

  if (!title || !content) {
    throw new Error("Title and content are required.");
  }

  const { error } = await supabase.from("communication_practice_rules").insert({
    title,
    category,
    content,
    is_active: true,
    created_by: user.id,
  });

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_practice_rule_created",
    entity_type: "communication_practice_rule",
    actor_user_id: user.id,
    metadata: { title, category },
  });

  revalidatePath("/communication-excellence/admin/practice-rules");
}

async function toggleRule(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole(["super_admin"]);

  const ruleId = String(formData.get("rule_id") || "");
  const nextState = formData.get("next_state") === "true";

  if (!ruleId) throw new Error("Rule is required.");

  const { error } = await supabase
    .from("communication_practice_rules")
    .update({
      is_active: nextState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ruleId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_practice_rule_updated",
    entity_type: "communication_practice_rule",
    entity_id: ruleId,
    actor_user_id: user.id,
    metadata: { is_active: nextState },
  });

  revalidatePath("/communication-excellence/admin/practice-rules");
}

export default async function PracticeRulesPage() {
  const { supabase } = await requireRole(["super_admin"]);

  const { data, error } = await supabase
    .from("communication_practice_rules")
    .select("id, title, category, content, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rules = (data ?? []) as RuleRow[];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Practice Communication Rules"
      description="Manage approved wording, practice-specific guidance, escalation notes and communication standards used by AI scenarios."
    >
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Create rule</h2>

        <form action={createRule} className="mt-5 grid gap-5">
          <Field label="Title">
            <input
              name="title"
              required
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Nervous patient reassurance"
            />
          </Field>

          <Field label="Category">
            <select
              name="category"
              defaultValue="general"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="general">General</option>
              <option value="approved_phrase">Approved phrase</option>
              <option value="avoid_phrase">Phrase to avoid</option>
              <option value="escalation">Escalation rule</option>
              <option value="fees">Fees and payments</option>
              <option value="parking">Parking and access</option>
              <option value="sedation">Sedation</option>
              <option value="referrals">Referrals</option>
              <option value="complaints">Complaints</option>
            </select>
          </Field>

          <Field label="Content">
            <textarea
              name="content"
              required
              rows={6}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Add approved wording or practice-specific guidance..."
            />
          </Field>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Create rule
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Existing rules</h2>

        <div className="mt-5 space-y-3">
          {rules.length === 0 ? (
            <EmptyState text="No practice communication rules yet." />
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {rule.title}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge label={rule.category} />
                      <Badge label={rule.is_active ? "Active" : "Inactive"} />
                    </div>

                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {rule.content}
                    </p>
                  </div>

                  <form action={toggleRule}>
                    <input type="hidden" name="rule_id" value={rule.id} />
                    <input
                      type="hidden"
                      name="next_state"
                      value={String(!rule.is_active)}
                    />

                    <button
                      className={[
                        "rounded-2xl px-4 py-2 text-sm font-semibold",
                        rule.is_active
                          ? "bg-red-50 text-red-700"
                          : "bg-emerald-50 text-emerald-700",
                      ].join(" ")}
                    >
                      {rule.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>
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

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
      {label.replaceAll("_", " ")}
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