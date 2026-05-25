import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type CallReviewRow = {
  id: string;
  reviewed_user_id: string | null;
  file_name: string | null;
  review_source: string | null;
  external_call_id: string | null;
  call_started_at: string | null;
  call_direction: string | null;
  caller_number: string | null;
  callee_number: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  overall_score: number;
  empathy_score: number;
  clarity_score: number;
  professionalism_score: number;
  escalation_score: number;
  ai_summary: string;
  queue_status: string;
  manager_notes: string | null;
  created_at: string;
};

async function updateCallQueueItem(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewId = String(formData.get("review_id") || "");
  const reviewedUserId = String(formData.get("reviewed_user_id") || "");
  const queueStatus = String(formData.get("queue_status") || "new");
  const managerNotes = String(formData.get("manager_notes") || "").trim();

  if (!reviewId) throw new Error("Review is required.");

  const { error } = await supabase
    .from("communication_call_reviews")
    .update({
      reviewed_user_id: reviewedUserId || null,
      queue_status: queueStatus,
      manager_notes: managerNotes || null,
    })
    .eq("id", reviewId);

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_queue_item_updated",
    entity_type: "communication_call_review",
    entity_id: reviewId,
    actor_user_id: user.id,
    metadata: {
      reviewed_user_id: reviewedUserId || null,
      queue_status: queueStatus,
      manager_notes: managerNotes || null,
    },
  });

  revalidatePath("/communication-excellence/admin/call-queue");
  revalidatePath(`/communication-excellence/call-reviews/${reviewId}`);
  revalidatePath("/communication-excellence/call-reviews");
  revalidatePath("/communication-excellence/admin/intelligence");
}

export default async function CallQueuePage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const [profilesResult, reviewsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .order("full_name", { ascending: true }),

    supabase
      .from("communication_call_reviews")
      .select(
        `
        id,
        reviewed_user_id,
        file_name,
        review_source,
        external_call_id,
        call_started_at,
        call_direction,
        caller_number,
        callee_number,
        duration_seconds,
        transcript,
        overall_score,
        empathy_score,
        clarity_score,
        professionalism_score,
        escalation_score,
        ai_summary,
        queue_status,
        manager_notes,
        created_at
        `
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const reviews = (reviewsResult.data ?? []) as CallReviewRow[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const unassigned = reviews.filter((review) => !review.reviewed_user_id);
  const lowScore = reviews.filter((review) => Number(review.overall_score || 0) < 75);
  const escalationRisk = reviews.filter(
    (review) => Number(review.escalation_score || 0) < 75
  );
  const missingTranscript = reviews.filter((review) => !review.transcript);
  const openItems = reviews.filter((review) => review.queue_status !== "resolved");

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Call Queue"
      description="Operational queue for unassigned calls, low scores, escalation risks and manager follow-up."
    >
      <section className="grid gap-4 md:grid-cols-5">
        <MetricCard title="Open" value={String(openItems.length)} />
        <MetricCard title="Unassigned" value={String(unassigned.length)} />
        <MetricCard title="Low Score" value={String(lowScore.length)} />
        <MetricCard title="Escalation Risk" value={String(escalationRisk.length)} />
        <MetricCard title="No Transcript" value={String(missingTranscript.length)} />
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Manager workflow
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          Use this page to assign calls to staff, mark queue status and add
          internal manager notes. This is especially useful because MaxoTel
          extensions are location-based rather than staff-specific.
        </p>
      </section>

      <section className="space-y-4">
        {reviews.length === 0 ? (
          <EmptyState text="No call reviews found." />
        ) : (
          reviews.map((review) => {
            const staff = review.reviewed_user_id
              ? profileById.get(review.reviewed_user_id)
              : null;

            const flags = getCallFlags(review);

            return (
              <section
                key={review.id}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={formatLabel(review.queue_status)} />
                      {flags.map((flag) => (
                        <WarningBadge key={flag} label={flag} />
                      ))}
                    </div>

                    <h2 className="mt-4 text-lg font-semibold text-slate-950">
                      {review.file_name || "Call review"}
                    </h2>

                    <p className="mt-1 text-sm text-slate-500">
                      Staff: {staff?.full_name || staff?.email || "Unassigned"}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge label={formatLabel(review.review_source || "manual")} />
                      {review.external_call_id ? (
                        <Badge label={`ID: ${review.external_call_id}`} />
                      ) : null}
                      {review.call_direction ? (
                        <Badge label={formatLabel(review.call_direction)} />
                      ) : null}
                      {review.call_started_at ? (
                        <Badge label={formatDateTime(review.call_started_at)} />
                      ) : null}
                    </div>

                    <p className="mt-4 text-sm leading-6 text-slate-600">
                      {review.ai_summary || "No AI summary saved."}
                    </p>
                  </div>

                  <div className="grid min-w-[260px] grid-cols-2 gap-3">
                    <ScoreMini title="Overall" value={review.overall_score} />
                    <ScoreMini title="Escalation" value={review.escalation_score} />
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <ScoreMini title="Empathy" value={review.empathy_score} />
                  <ScoreMini title="Clarity" value={review.clarity_score} />
                  <ScoreMini
                    title="Professionalism"
                    value={review.professionalism_score}
                  />
                  <ScoreMini title="Escalation" value={review.escalation_score} />
                </div>

                <form
                  action={updateCallQueueItem}
                  className="mt-6 grid gap-4 rounded-2xl bg-slate-50 p-5"
                >
                  <input type="hidden" name="review_id" value={review.id} />

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Assign staff">
                      <select
                        name="reviewed_user_id"
                        defaultValue={review.reviewed_user_id || ""}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                      >
                        <option value="">Unassigned</option>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.full_name || profile.email}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Queue status">
                      <select
                        name="queue_status"
                        defaultValue={review.queue_status || "new"}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                      >
                        <option value="new">New</option>
                        <option value="needs_assignment">Needs assignment</option>
                        <option value="needs_review">Needs review</option>
                        <option value="coaching_assigned">Coaching assigned</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </Field>
                  </div>

                  <Field label="Manager notes">
                    <textarea
                      name="manager_notes"
                      defaultValue={review.manager_notes || ""}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                      placeholder="Internal notes, coaching follow-up, context..."
                    />
                  </Field>

                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
                      Save queue update
                    </button>

                    <Link
                      href={`/communication-excellence/call-reviews/${review.id}`}
                      className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
                    >
                      View full review
                    </Link>
                  </div>
                </form>
              </section>
            );
          })
        )}
      </section>
    </PageLayout>
  );
}

function getCallFlags(review: CallReviewRow) {
  const flags: string[] = [];

  if (!review.reviewed_user_id) flags.push("Unassigned");
  if (!review.transcript) flags.push("No transcript");
  if (Number(review.overall_score || 0) < 75) flags.push("Low score");
  if (Number(review.escalation_score || 0) < 75) flags.push("Escalation risk");

  return flags;
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-2 text-3xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ScoreMini({
  title,
  value,
}: {
  title: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-950">
        {value === null || value === undefined ? "—" : `${value}%`}
      </div>
    </div>
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
      {label}
    </span>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold capitalize text-blue-700 ring-1 ring-blue-200">
      {label}
    </span>
  );
}

function WarningBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
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