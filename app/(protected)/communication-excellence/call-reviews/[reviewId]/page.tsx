import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type PageProps = {
  params: Promise<{ reviewId: string }>;
};

async function assignCallReviewStaff(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewId = String(formData.get("review_id") || "");
  const reviewedUserId = String(formData.get("reviewed_user_id") || "");

  if (!reviewId) throw new Error("Review is required.");

  const { error } = await supabase
    .from("communication_call_reviews")
    .update({
      reviewed_user_id: reviewedUserId || null,
    })
    .eq("id", reviewId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_review_staff_assigned",
    entity_type: "communication_call_review",
    entity_id: reviewId,
    actor_user_id: user.id,
    metadata: {
      reviewed_user_id: reviewedUserId || null,
    },
  });

  revalidatePath(`/communication-excellence/call-reviews/${reviewId}`);
  revalidatePath("/communication-excellence/call-reviews");
  revalidatePath("/communication-excellence/admin/intelligence");
}

async function calibrateCallReview(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewId = String(formData.get("review_id") || "");

  if (!reviewId) throw new Error("Review is required.");

  const managerOverallScore = scoreOrNull(formData.get("manager_overall_score"));
  const managerEmpathyScore = scoreOrNull(formData.get("manager_empathy_score"));
  const managerClarityScore = scoreOrNull(formData.get("manager_clarity_score"));
  const managerProfessionalismScore = scoreOrNull(
    formData.get("manager_professionalism_score")
  );
  const managerEscalationScore = scoreOrNull(
    formData.get("manager_escalation_score")
  );

  const aiScoreAccuracy = String(formData.get("ai_score_accuracy") || "");
  const coachingAppropriateValue = String(
    formData.get("coaching_appropriate") || ""
  );
  const calibrationNotes = String(formData.get("calibration_notes") || "").trim();

  const coachingAppropriate =
    coachingAppropriateValue === ""
      ? null
      : coachingAppropriateValue === "yes";

  const { error } = await supabase
    .from("communication_call_reviews")
    .update({
      manager_overall_score: managerOverallScore,
      manager_empathy_score: managerEmpathyScore,
      manager_clarity_score: managerClarityScore,
      manager_professionalism_score: managerProfessionalismScore,
      manager_escalation_score: managerEscalationScore,
      ai_score_accuracy: aiScoreAccuracy || null,
      coaching_appropriate: coachingAppropriate,
      calibration_notes: calibrationNotes || null,
      calibrated_by: user.id,
      calibrated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_review_calibrated",
    entity_type: "communication_call_review",
    entity_id: reviewId,
    actor_user_id: user.id,
    metadata: {
      manager_overall_score: managerOverallScore,
      manager_empathy_score: managerEmpathyScore,
      manager_clarity_score: managerClarityScore,
      manager_professionalism_score: managerProfessionalismScore,
      manager_escalation_score: managerEscalationScore,
      ai_score_accuracy: aiScoreAccuracy || null,
      coaching_appropriate: coachingAppropriate,
      calibration_notes: calibrationNotes || null,
    },
  });

  revalidatePath(`/communication-excellence/call-reviews/${reviewId}`);
  revalidatePath("/communication-excellence/admin/call-queue");
  revalidatePath("/communication-excellence/admin/intelligence");
}

export default async function CallReviewDetailPage({ params }: PageProps) {
  const { reviewId } = await params;

  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [reviewResult, profilesResult] = await Promise.all([
    supabase
      .from("communication_call_reviews")
      .select("*")
      .eq("id", reviewId)
      .single(),

    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true }),
  ]);

  if (reviewResult.error) throw new Error(reviewResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const review = reviewResult.data as any;
  const profiles = profilesResult.data ?? [];
  const staff = profiles.find((p: any) => p.id === review.reviewed_user_id);
  const coachingFeedback = review.coaching_feedback ?? {};

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title={review.file_name || "Call Review"}
      description="Detailed AI communication review for this call."
    >
      <Link
        href="/communication-excellence/call-reviews"
        className="inline-flex rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
      >
        ← Back to call reviews
      </Link>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">
              {review.file_name || "Manual transcript"}
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Staff: {staff?.full_name || staff?.email || "Unassigned"}
            </p>

            <p className="mt-1 text-sm text-slate-400">
              Reviewed: {formatDateTime(review.created_at)}
            </p>

            {review.calibrated_at ? (
              <p className="mt-1 text-sm text-blue-700">
                Manager calibrated: {formatDateTime(review.calibrated_at)}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl bg-slate-50 px-6 py-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              AI Overall Score
            </div>
            <div className="mt-1 text-4xl font-semibold text-slate-950">
              {review.overall_score}%
            </div>

            {review.manager_overall_score !== null &&
            review.manager_overall_score !== undefined ? (
              <div className="mt-3 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                Manager: {review.manager_overall_score}%
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-6 text-sm leading-6 text-slate-700">
          {review.ai_summary}
        </p>
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Assign staff member
        </h2>

        <form
          action={assignCallReviewStaff}
          className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]"
        >
          <input type="hidden" name="review_id" value={review.id} />

          <select
            name="reviewed_user_id"
            defaultValue={review.reviewed_user_id || ""}
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="">Unassigned</option>
            {profiles.map((profile: any) => (
              <option key={profile.id} value={profile.id}>
                {profile.full_name || profile.email}
              </option>
            ))}
          </select>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Save staff assignment
          </button>
        </form>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetaCard
          title="Source"
          value={formatLabel(review.review_source || "manual_transcript")}
        />
        <MetaCard
          title="Call Time"
          value={
            review.call_started_at ? formatDateTime(review.call_started_at) : "—"
          }
        />
        <MetaCard
          title="Direction"
          value={formatLabel(review.call_direction || "—")}
        />
        <MetaCard
          title="Duration"
          value={
            review.duration_seconds
              ? `${Math.round(Number(review.duration_seconds) / 60)} min`
              : "—"
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <MetaCard title="Caller" value={review.caller_number || "—"} />
        <MetaCard title="Callee" value={review.callee_number || "—"} />
        <MetaCard title="External ID" value={review.external_call_id || "—"} />
        <MetaCard
          title="Disclaimer"
          value={
            review.consent_disclaimer_confirmed ? "Confirmed" : "Not confirmed"
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <ScoreCard
          title="Empathy"
          aiValue={review.empathy_score}
          managerValue={review.manager_empathy_score}
        />
        <ScoreCard
          title="Clarity"
          aiValue={review.clarity_score}
          managerValue={review.manager_clarity_score}
        />
        <ScoreCard
          title="Professionalism"
          aiValue={review.professionalism_score}
          managerValue={review.manager_professionalism_score}
        />
        <ScoreCard
          title="Escalation"
          aiValue={review.escalation_score}
          managerValue={review.manager_escalation_score}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <ListPanel title="Strengths" items={review.strengths ?? []} />
        <ListPanel title="Improvements" items={review.improvements ?? []} />
        <ListPanel
          title="Recommended Focus"
          items={coachingFeedback.recommended_focus ?? []}
        />
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Manager calibration
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-700">
          Use this to record whether the AI score was accurate and override
          scores when needed. This creates future calibration data.
        </p>

        <form action={calibrateCallReview} className="mt-5 grid gap-5">
          <input type="hidden" name="review_id" value={review.id} />

          <section className="grid gap-4 md:grid-cols-5">
            <ScoreInput
              label="Overall"
              name="manager_overall_score"
              defaultValue={review.manager_overall_score}
              placeholder={String(review.overall_score ?? "")}
            />
            <ScoreInput
              label="Empathy"
              name="manager_empathy_score"
              defaultValue={review.manager_empathy_score}
              placeholder={String(review.empathy_score ?? "")}
            />
            <ScoreInput
              label="Clarity"
              name="manager_clarity_score"
              defaultValue={review.manager_clarity_score}
              placeholder={String(review.clarity_score ?? "")}
            />
            <ScoreInput
              label="Professionalism"
              name="manager_professionalism_score"
              defaultValue={review.manager_professionalism_score}
              placeholder={String(review.professionalism_score ?? "")}
            />
            <ScoreInput
              label="Escalation"
              name="manager_escalation_score"
              defaultValue={review.manager_escalation_score}
              placeholder={String(review.escalation_score ?? "")}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Was the AI score accurate?">
              <select
                name="ai_score_accuracy"
                defaultValue={review.ai_score_accuracy || ""}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="">Not assessed</option>
                <option value="accurate">Accurate</option>
                <option value="too_harsh">Too harsh</option>
                <option value="too_lenient">Too lenient</option>
                <option value="mixed">Mixed</option>
              </select>
            </Field>

            <Field label="Were coaching suggestions appropriate?">
              <select
                name="coaching_appropriate"
                defaultValue={
                  review.coaching_appropriate === null ||
                  review.coaching_appropriate === undefined
                    ? ""
                    : review.coaching_appropriate
                      ? "yes"
                      : "no"
                }
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="">Not assessed</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          </section>

          <Field label="Calibration notes">
            <textarea
              name="calibration_notes"
              defaultValue={review.calibration_notes || ""}
              rows={4}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: AI was slightly too harsh on escalation because the patient was calm by the end."
            />
          </Field>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Save calibration
          </button>
        </form>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Transcript</h2>

        {review.transcript ? (
          <div className="mt-5 whitespace-pre-wrap rounded-2xl bg-slate-50 p-5 text-sm leading-7 text-slate-700">
            {review.transcript}
          </div>
        ) : (
          <EmptyState text="No transcript saved for this review." />
        )}
      </section>
    </PageLayout>
  );
}

function scoreOrNull(value: FormDataEntryValue | null): number | null {
  const stringValue = String(value || "").trim();
  if (!stringValue) return null;

  const numericValue = Number(stringValue);
  if (Number.isNaN(numericValue)) return null;

  if (numericValue < 0) return 0;
  if (numericValue > 100) return 100;

  return Math.round(numericValue);
}

function ScoreInput({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: number | null | undefined;
  placeholder: string;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      <input
        name={name}
        type="number"
        min={0}
        max={100}
        defaultValue={
          defaultValue === null || defaultValue === undefined
            ? ""
            : String(defaultValue)
        }
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
      />
    </label>
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

function MetaCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 break-words text-sm font-semibold text-slate-950">
        {value}
      </div>
    </div>
  );
}

function ScoreCard({
  title,
  aiValue,
  managerValue,
}: {
  title: string;
  aiValue: number;
  managerValue: number | null | undefined;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-950">
        {aiValue}%
      </div>
      <div className="mt-1 text-xs text-slate-400">AI score</div>

      {managerValue !== null && managerValue !== undefined ? (
        <div className="mt-3 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
          Manager: {managerValue}%
        </div>
      ) : null}
    </div>
  );
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>

      <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
        {items.length === 0 ? (
          <li>—</li>
        ) : (
          items.map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
      {text}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  if (!value || value === "—") return "—";
  return value.replaceAll("_", " ");
}