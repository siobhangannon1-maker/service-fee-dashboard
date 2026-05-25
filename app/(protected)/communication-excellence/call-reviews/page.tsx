import Link from "next/link";
import { revalidatePath } from "next/cache";
import PageLayout from "@/components/ui/PageLayout";
import { requireRole } from "@/lib/auth";
import {
  getActiveCallScoringRubric,
  reviewCommunicationCall,
} from "@/lib/communication-excellence/call-review-ai";
import { transcribeAudioFile } from "@/lib/communication-excellence/transcribe-audio";

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type CallMetadataInput = {
  reviewSource: string;
  externalCallId?: string | null;
  callStartedAt?: string | null;
  callDirection?: string | null;
  callerNumber?: string | null;
  calleeNumber?: string | null;
  durationSeconds?: number | null;
  consentDisclaimerConfirmed?: boolean;
};

async function analyseTranscript({
  supabase,
  actorUserId,
  reviewedUserId,
  fileName,
  transcript,
  reviewSource,
  externalCallId,
  callStartedAt,
  callDirection,
  callerNumber,
  calleeNumber,
  durationSeconds,
  consentDisclaimerConfirmed,
}: {
  supabase: any;
  actorUserId: string;
  reviewedUserId: string;
  fileName: string;
  transcript: string;
} & CallMetadataInput) {
  const rubricText = await getActiveCallScoringRubric(supabase);

  const result = await reviewCommunicationCall({
    transcript,
    rubricText,
  });

  const { data, error } = await supabase
    .from("communication_call_reviews")
    .insert({
      uploaded_by: actorUserId,
      reviewed_user_id: reviewedUserId,
      file_name: fileName || "Manual transcript",
      transcript,

      review_source: reviewSource,
      external_call_id: externalCallId || null,
      call_started_at: normaliseDatetimeLocal(callStartedAt),
      call_direction: callDirection || null,
      caller_number: callerNumber || null,
      callee_number: calleeNumber || null,
      duration_seconds: durationSeconds || null,
      consent_disclaimer_confirmed: Boolean(consentDisclaimerConfirmed),
      metadata: {
        source: reviewSource,
        rubric_used: Boolean(rubricText),
      },

      overall_score: result.overall_score,
      empathy_score: result.empathy_score,
      clarity_score: result.clarity_score,
      professionalism_score: result.professionalism_score,
      escalation_score: result.escalation_score,
      strengths: result.strengths,
      improvements: result.improvements,
      ai_summary: result.ai_summary,
      coaching_feedback: {
        recommended_focus: result.recommended_focus,
        strengths: result.strengths,
        improvements: result.improvements,
      },
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    action: "communication_call_review_created",
    entity_type: "communication_call_review",
    entity_id: data.id,
    actor_user_id: actorUserId,
    metadata: {
      reviewed_user_id: reviewedUserId,
      overall_score: result.overall_score,
      empathy_score: result.empathy_score,
      clarity_score: result.clarity_score,
      professionalism_score: result.professionalism_score,
      escalation_score: result.escalation_score,
      source: reviewSource,
      file_name: fileName,
      external_call_id: externalCallId || null,
      call_started_at: callStartedAt || null,
      call_direction: callDirection || null,
      caller_number: callerNumber || null,
      callee_number: calleeNumber || null,
      duration_seconds: durationSeconds || null,
      consent_disclaimer_confirmed: Boolean(consentDisclaimerConfirmed),
      rubric_used: Boolean(rubricText),
    },
  });

  await autoAssignCallMicrolearning({
    supabase,
    userId: reviewedUserId,
    recommendedFocus: result.recommended_focus,
  });

  await writeCallSkillHistory({
    supabase,
    userId: reviewedUserId,
    sourceId: data.id,
    result,
  });
}

async function reviewTranscript(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewedUserId = String(formData.get("reviewed_user_id") || "");
  const fileName = String(formData.get("file_name") || "").trim();
  const transcript = String(formData.get("transcript") || "").trim();

  if (!reviewedUserId || !transcript) {
    throw new Error("Staff member and transcript are required.");
  }

  await analyseTranscript({
    supabase,
    actorUserId: user.id,
    reviewedUserId,
    fileName: fileName || "Manual transcript",
    transcript,
    reviewSource: "manual_transcript",
    ...getCallMetadataFromForm(formData),
  });

  revalidatePath("/communication-excellence/call-reviews");
}

async function reviewAudio(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewedUserId = String(formData.get("reviewed_user_id") || "");
  const audioFile = formData.get("audio_file");

  if (!reviewedUserId) {
    throw new Error("Staff member is required.");
  }

  if (!(audioFile instanceof File) || audioFile.size === 0) {
    throw new Error("Audio file is required.");
  }

  const maxBytes = 25 * 1024 * 1024;

  if (audioFile.size > maxBytes) {
    throw new Error("Audio file is too large. Please use a file under 25MB.");
  }

  const transcript = await transcribeAudioFile(audioFile);

  if (!transcript) {
    throw new Error("No transcript was returned from the audio file.");
  }

  await analyseTranscript({
    supabase,
    actorUserId: user.id,
    reviewedUserId,
    fileName: audioFile.name || "Uploaded audio",
    transcript,
    reviewSource: "audio_upload",
    ...getCallMetadataFromForm(formData),
  });

  revalidatePath("/communication-excellence/call-reviews");
}

async function autoAssignCallMicrolearning({
  supabase,
  userId,
  recommendedFocus,
}: {
  supabase: any;
  userId: string;
  recommendedFocus: string[];
}) {
  if (!recommendedFocus || recommendedFocus.length === 0) return;

  const { data: templates, error } = await supabase
    .from("communication_microlearning_templates")
    .select("*")
    .eq("is_active", true);

  if (error || !templates) {
    console.error(error);
    return;
  }

  for (const focus of recommendedFocus) {
    const focusLower = String(focus).toLowerCase();

    const template = templates.find((item: any) => {
      const templateFocus = String(item.competency_focus || "").toLowerCase();
      const title = String(item.title || "").toLowerCase();
      const description = String(item.description || "").toLowerCase();

      return (
        templateFocus.includes(focusLower) ||
        focusLower.includes(templateFocus) ||
        title.includes(focusLower) ||
        description.includes(focusLower)
      );
    });

    if (!template) continue;

    await supabase.from("communication_microlearning").insert({
      user_id: userId,
      title: template.title,
      description: [template.description, template.content]
        .filter(Boolean)
        .join("\n\n"),
      assigned_reason: `Automatically assigned after call review: ${focus}`,
      status: "assigned",
      due_date: getDateDaysFromNow(7),
    });
  }
}

async function writeCallSkillHistory({
  supabase,
  userId,
  sourceId,
  result,
}: {
  supabase: any;
  userId: string;
  sourceId: string;
  result: {
    overall_score: number;
    empathy_score: number;
    clarity_score: number;
    professionalism_score: number;
    escalation_score: number;
  };
}) {
  const { data: competencies, error } = await supabase
    .from("communication_competencies")
    .select("id, name")
    .eq("is_active", true);

  if (error || !competencies) {
    console.error(error);
    return;
  }

  const mappings = [
    { match: "empathy", score: result.empathy_score },
    { match: "clarity", score: result.clarity_score },
    { match: "professionalism", score: result.professionalism_score },
    { match: "escalation", score: result.escalation_score },
    { match: "patient communication", score: result.overall_score },
  ];

  for (const mapping of mappings) {
    const competency = competencies.find((item: any) =>
      String(item.name || "").toLowerCase().includes(mapping.match)
    );

    if (!competency) continue;

    await supabase.from("communication_skill_score_history").insert({
      user_id: userId,
      competency_id: competency.id,
      source_type: "call_review",
      source_id: sourceId,
      score: mapping.score,
      metadata: {
        overall_score: result.overall_score,
        empathy_score: result.empathy_score,
        clarity_score: result.clarity_score,
        professionalism_score: result.professionalism_score,
        escalation_score: result.escalation_score,
      },
    });

    await supabase.from("communication_skill_scores").upsert({
      user_id: userId,
      competency_id: competency.id,
      score: mapping.score,
      evidence_count: 1,
      last_updated_at: new Date().toISOString(),
    });
  }
}

export default async function CallReviewsPage() {
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
        transcript,
        review_source,
        external_call_id,
        call_started_at,
        call_direction,
        caller_number,
        callee_number,
        duration_seconds,
        consent_disclaimer_confirmed,
        overall_score,
        empathy_score,
        clarity_score,
        professionalism_score,
        escalation_score,
        strengths,
        improvements,
        ai_summary,
        created_at
        `
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message);

  const profiles = (profilesResult.data ?? []) as ProfileRow[];
  const reviews = reviewsResult.data ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Call Reviews"
      description="Upload audio or paste transcripts for AI communication review."
    >
      <section className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Upload audio file
          </h2>

          <p className="mt-2 text-sm leading-6 text-slate-500">
            Upload a recorded call file. The app will transcribe it, score the
            communication, and save the review using the active scoring rubric.
          </p>

          <form action={reviewAudio} className="mt-5 grid gap-5">
            <StaffSelect profiles={profiles} />
            <CallMetadataFields />

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                Audio file
              </div>

              <input
                name="audio_file"
                type="file"
                required
                accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />

              <p className="mt-2 text-xs text-slate-400">
                Keep files under 25MB for this starter version.
              </p>
            </label>

            <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              Transcribe and analyse audio
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">
            Paste transcript
          </h2>

          <form action={reviewTranscript} className="mt-5 grid gap-5">
            <StaffSelect profiles={profiles} />
            <CallMetadataFields />

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                Call/reference name
              </div>

              <input
                name="file_name"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Example: Nervous patient call - 25 May"
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                Transcript
              </div>

              <textarea
                name="transcript"
                required
                rows={10}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Paste the call transcript here..."
              />
            </label>

            <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
              Analyse transcript
            </button>
          </form>
        </section>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Recent call reviews
        </h2>

        <div className="mt-5 space-y-4">
          {reviews.length === 0 ? (
            <EmptyState text="No call reviews yet." />
          ) : (
            reviews.map((review: any) => (
              <div
                key={review.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-semibold text-slate-950">
                      {review.file_name || "Manual transcript"}
                    </div>

                    <div className="mt-1 text-sm text-slate-500">
                      Staff:{" "}
                      {profileById.get(review.reviewed_user_id)?.full_name ||
                        profileById.get(review.reviewed_user_id)?.email ||
                        "Unknown"}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge label={formatLabel(review.review_source || "manual_transcript")} />
                      {review.call_direction ? (
                        <Badge label={formatLabel(review.call_direction)} />
                      ) : null}
                      {review.call_started_at ? (
                        <Badge label={formatDateTime(review.call_started_at)} />
                      ) : null}
                      {review.consent_disclaimer_confirmed ? (
                        <Badge label="Disclaimer confirmed" />
                      ) : null}
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {review.ai_summary}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 px-5 py-4 text-center">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Overall
                    </div>
                    <div className="mt-1 text-3xl font-semibold text-slate-950">
                      {review.overall_score}%
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <ScoreMini title="Empathy" value={review.empathy_score} />
                  <ScoreMini title="Clarity" value={review.clarity_score} />
                  <ScoreMini
                    title="Professionalism"
                    value={review.professionalism_score}
                  />
                  <ScoreMini
                    title="Escalation"
                    value={review.escalation_score}
                  />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <ListBlock title="Strengths" items={review.strengths ?? []} />
                  <ListBlock
                    title="Improvements"
                    items={review.improvements ?? []}
                  />
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={`/communication-excellence/call-reviews/${review.id}`}
                    className="inline-flex rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
                  >
                    View review
                  </Link>
                </div>

                {review.transcript ? (
                  <details className="mt-5 rounded-2xl bg-slate-50 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                      View transcript
                    </summary>

                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {review.transcript}
                    </div>
                  </details>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </PageLayout>
  );
}

function StaffSelect({ profiles }: { profiles: ProfileRow[] }) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium text-slate-700">
        Staff member
      </div>

      <select
        name="reviewed_user_id"
        required
        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
      >
        <option value="">Select staff member</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.full_name || profile.email}
          </option>
        ))}
      </select>
    </label>
  );
}

function CallMetadataFields() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          External call ID
        </div>
        <input
          name="external_call_id"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          placeholder="Optional MaxoTel call ID"
        />
      </label>

      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Call started at
        </div>
        <input
          name="call_started_at"
          type="datetime-local"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
        />
      </label>

      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Direction
        </div>
        <select
          name="call_direction"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
        >
          <option value="">Unknown</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
      </label>

      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Duration seconds
        </div>
        <input
          name="duration_seconds"
          type="number"
          min={0}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          placeholder="Optional"
        />
      </label>

      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Caller number
        </div>
        <input
          name="caller_number"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          placeholder="Optional"
        />
      </label>

      <label className="block">
        <div className="mb-2 text-sm font-medium text-slate-700">
          Callee number
        </div>
        <input
          name="callee_number"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          placeholder="Optional"
        />
      </label>

      <label className="flex items-center gap-3 rounded-2xl bg-blue-50 p-4 text-sm font-medium text-blue-900 md:col-span-2">
        <input
          name="consent_disclaimer_confirmed"
          type="checkbox"
          className="h-4 w-4"
        />
        Consent/disclaimer confirmed for this call
      </label>
    </div>
  );
}

function ScoreMini({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 text-center ring-1 ring-slate-200">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}%</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>

      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length === 0 ? (
          <li>—</li>
        ) : (
          items.map((item, index) => <li key={index}>• {item}</li>)
        )}
      </ul>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">
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

function getCallMetadataFromForm(formData: FormData): Omit<
  CallMetadataInput,
  "reviewSource"
> {
  return {
    externalCallId: String(formData.get("external_call_id") || "").trim() || null,
    callStartedAt: String(formData.get("call_started_at") || "").trim() || null,
    callDirection: String(formData.get("call_direction") || "").trim() || null,
    callerNumber: String(formData.get("caller_number") || "").trim() || null,
    calleeNumber: String(formData.get("callee_number") || "").trim() || null,
    durationSeconds: Number(formData.get("duration_seconds") || 0) || null,
    consentDisclaimerConfirmed:
      formData.get("consent_disclaimer_confirmed") === "on",
  };
}

function normaliseDatetimeLocal(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

function getDateDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

