import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

const defaultRubric = `Dental Communication Excellence Call Scoring Rubric

All scores must be 0–100.

Empathy:
90–100: Patient emotions are clearly acknowledged, reassurance is calm and specific, staff avoids dismissive phrases, and patient feels supported.
80–89: Warm and polite with some reassurance.
70–79: Acceptable but emotionally flat or slightly rushed.
60–69: Limited acknowledgement of anxiety or concern.
Below 60: Dismissive, abrupt, argumentative, or ignores distress.

Clarity:
90–100: Explains clearly, avoids jargon, checks understanding, gives clear next steps.
80–89: Mostly clear with minor gaps.
70–79: Understandable but missing some next steps.
60–69: Confusing or incomplete.
Below 60: Patient likely leaves confused.

Professionalism:
90–100: Calm, respectful, organised, confident, appropriate tone.
80–89: Professional with minor missed opportunities.
70–79: Acceptable but may sound rushed or casual.
60–69: Disorganised or uncertain.
Below 60: Defensive, sarcastic, abrupt, or inappropriate.

Escalation Judgement:
90–100: Identifies risk early, de-escalates well, offers appropriate clinician/manager escalation.
80–89: Good judgement with minor gaps.
70–79: Escalation acceptable but delayed.
60–69: Missed cues or weak handoff.
Below 60: Fails to escalate complaint, distress, refund/legal threat, clinical concern, or safety issue.

Cost Conversations:
Excellent communication explains fees confidently, avoids apologising unnecessarily, offers options where appropriate, and does not overpromise.

Nervous Patient Communication:
Excellent communication validates anxiety, explains what will happen, offers reassurance, and avoids “you’ll be fine” as the only reassurance.

Red Flags:
Lower escalation score and flag coaching if the call includes:
- angry or distressed patient
- complaint about treatment
- refund demand
- legal threat
- sedation misunderstanding
- medication or safety concern
- repeated confusion
- patient crying or panicking

Practice tone:
Calm, reassuring, confident, educational, respectful, never rushed, never dismissive.`;

async function createRubric(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const title = String(formData.get("title") || "").trim();
  const rubricText = String(formData.get("rubric_text") || "").trim();
  const makeActive = formData.get("is_active") === "on";

  if (!title || !rubricText) {
    throw new Error("Title and rubric text are required.");
  }

  if (makeActive) {
    await supabase
      .from("communication_call_scoring_rubrics")
      .update({ is_active: false });
  }

  const { data, error } = await supabase
    .from("communication_call_scoring_rubrics")
    .insert({
      title,
      rubric_text: rubricText,
      is_active: makeActive,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_rubric_created",
    entity_type: "communication_call_scoring_rubric",
    entity_id: data.id,
    actor_user_id: user.id,
    metadata: {
      title,
      is_active: makeActive,
    },
  });

  revalidatePath("/communication-excellence/admin/call-rubric");
}

async function updateRubric(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const rubricId = String(formData.get("rubric_id") || "");
  const title = String(formData.get("title") || "").trim();
  const rubricText = String(formData.get("rubric_text") || "").trim();
  const makeActive = formData.get("is_active") === "on";

  if (!rubricId || !title || !rubricText) {
    throw new Error("Rubric, title and rubric text are required.");
  }

  if (makeActive) {
    await supabase
      .from("communication_call_scoring_rubrics")
      .update({ is_active: false });
  }

  const { error } = await supabase
    .from("communication_call_scoring_rubrics")
    .update({
      title,
      rubric_text: rubricText,
      is_active: makeActive,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rubricId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_rubric_updated",
    entity_type: "communication_call_scoring_rubric",
    entity_id: rubricId,
    actor_user_id: user.id,
    metadata: {
      title,
      is_active: makeActive,
    },
  });

  revalidatePath("/communication-excellence/admin/call-rubric");
}

export default async function CallRubricPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("communication_call_scoring_rubrics")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rubrics = data ?? [];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Call Scoring Rubric"
      description="Control how AI scores call reviews without changing code."
    >
      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Recommended approach
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Keep one active rubric. The AI will use the active rubric whenever it
          scores a call transcript or audio recording.
        </p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Create new rubric
        </h2>

        <form action={createRubric} className="mt-5 grid gap-5">
          <Field label="Title">
            <input
              name="title"
              required
              defaultValue="Dental Call Scoring Rubric"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
            />
          </Field>

          <Field label="Rubric text">
            <textarea
              name="rubric_text"
              required
              rows={24}
              defaultValue={defaultRubric}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6"
            />
          </Field>

          <label className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
            <input name="is_active" type="checkbox" defaultChecked />
            Make this the active rubric
          </label>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Create rubric
          </button>
        </form>
      </section>

      <section className="space-y-4">
        {rubrics.length === 0 ? (
          <EmptyState text="No rubrics created yet." />
        ) : (
          rubrics.map((rubric: any) => (
            <section
              key={rubric.id}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">
                    {rubric.title}
                  </h2>
                  <div className="mt-2 flex gap-2">
                    {rubric.is_active ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <form action={updateRubric} className="mt-5 grid gap-5">
                <input type="hidden" name="rubric_id" value={rubric.id} />

                <Field label="Title">
                  <input
                    name="title"
                    required
                    defaultValue={rubric.title}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  />
                </Field>

                <Field label="Rubric text">
                  <textarea
                    name="rubric_text"
                    required
                    rows={18}
                    defaultValue={rubric.rubric_text}
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6"
                  />
                </Field>

                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-700">
                  <input
                    name="is_active"
                    type="checkbox"
                    defaultChecked={rubric.is_active}
                  />
                  Make active
                </label>

                <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                  Save rubric
                </button>
              </form>
            </section>
          ))
        )}
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
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}