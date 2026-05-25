import { revalidatePath } from "next/cache";
import Link from "next/link";
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

async function importMaxotelCall(formData: FormData) {
  "use server";

  const { supabase, user } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const reviewedUserId = String(formData.get("reviewed_user_id") || "");
  const externalCallId = String(formData.get("external_call_id") || "").trim();
  const callStartedAt = String(formData.get("call_started_at") || "").trim();
  const callDirection = String(formData.get("call_direction") || "").trim();
  const callerNumber = String(formData.get("caller_number") || "").trim();
  const calleeNumber = String(formData.get("callee_number") || "").trim();
  const durationSeconds = Number(formData.get("duration_seconds") || 0) || null;
  const transcriptInput = String(formData.get("transcript") || "").trim();
  const audioFile = formData.get("audio_file");
  const consentDisclaimerConfirmed =
    formData.get("consent_disclaimer_confirmed") === "on";

  if (!reviewedUserId) {
    throw new Error("Staff member is required.");
  }

  if (!externalCallId) {
    throw new Error("External MaxoTel call ID is required.");
  }

  let transcript = transcriptInput;
  let fileName = `MaxoTel call ${externalCallId}`;

  if (!transcript && audioFile instanceof File && audioFile.size > 0) {
    const maxBytes = 25 * 1024 * 1024;

    if (audioFile.size > maxBytes) {
      throw new Error("Audio file is too large. Please use a file under 25MB.");
    }

    transcript = await transcribeAudioFile(audioFile);
    fileName = audioFile.name || fileName;
  }

  if (!transcript) {
    throw new Error("Please provide either a transcript or an audio file.");
  }

  const rubricText = await getActiveCallScoringRubric(supabase);

  const result = await reviewCommunicationCall({
    transcript,
    rubricText,
  });

  const { data, error } = await supabase
    .from("communication_call_reviews")
    .insert({
      uploaded_by: user.id,
      reviewed_user_id: reviewedUserId,
      file_name: fileName,
      transcript,

      review_source: "maxotel_manual",
      external_call_id: externalCallId,
      call_started_at: normaliseDatetimeLocal(callStartedAt),
      call_direction: callDirection || null,
      caller_number: callerNumber || null,
      callee_number: calleeNumber || null,
      duration_seconds: durationSeconds,
      consent_disclaimer_confirmed: consentDisclaimerConfirmed,
      metadata: {
        source: "maxotel_manual",
        imported_manually: true,
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
    action: "communication_maxotel_manual_call_imported",
    entity_type: "communication_call_review",
    entity_id: data.id,
    actor_user_id: user.id,
    metadata: {
      reviewed_user_id: reviewedUserId,
      external_call_id: externalCallId,
      call_started_at: callStartedAt || null,
      call_direction: callDirection || null,
      caller_number: callerNumber || null,
      callee_number: calleeNumber || null,
      duration_seconds: durationSeconds,
      consent_disclaimer_confirmed: consentDisclaimerConfirmed,
      overall_score: result.overall_score,
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

  revalidatePath("/communication-excellence/call-reviews");
  revalidatePath("/communication-excellence/admin/integrations/maxotel/import-call");
}

export default async function MaxotelManualImportPage() {
  const { supabase } = await requireRole([
    "super_admin",
    "admin",
    "practice_manager",
  ]);

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);

  const profiles = (data ?? []) as ProfileRow[];

  return (
    <PageLayout
      eyebrow="Communication Excellence"
      title="Import MaxoTel Call"
      description="Manually import a MaxoTel-style call record before the live API sync is connected."
    >
      <div className="flex flex-wrap gap-3">
        <Link
          href="/communication-excellence/admin/integrations/maxotel"
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          ← Back to MaxoTel settings
        </Link>

        <Link
          href="/communication-excellence/call-reviews"
          className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
        >
          View call reviews
        </Link>
      </div>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Manual MaxoTel import
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-700">
          Use this page to test MaxoTel-style call metadata, staff mapping,
          transcription, AI review and coaching before connecting the real API.
          The active call scoring rubric will be used when scoring this call.
        </p>
      </section>

      <form
        action={importMaxotelCall}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-6">
          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Staff member">
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
            </Field>

            <Field label="External MaxoTel call ID">
              <input
                name="external_call_id"
                required
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Example: mx-call-123456"
              />
            </Field>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Field label="Call started at">
              <input
                name="call_started_at"
                type="datetime-local"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />
            </Field>

            <Field label="Direction">
              <select
                name="call_direction"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              >
                <option value="">Unknown</option>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
                <option value="internal">Internal</option>
              </select>
            </Field>

            <Field label="Caller number">
              <input
                name="caller_number"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Optional"
              />
            </Field>

            <Field label="Callee number">
              <input
                name="callee_number"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Optional"
              />
            </Field>

            <Field label="Duration seconds">
              <input
                name="duration_seconds"
                type="number"
                min={0}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Optional"
              />
            </Field>

            <label className="flex items-center gap-3 rounded-2xl bg-blue-50 p-4 text-sm font-medium text-blue-900">
              <input
                name="consent_disclaimer_confirmed"
                type="checkbox"
                className="h-4 w-4"
              />
              Consent/disclaimer confirmed for this call
            </label>
          </section>

          <section className="grid gap-4">
            <Field label="Audio file optional">
              <input
                name="audio_file"
                type="file"
                accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />

              <p className="mt-2 text-xs text-slate-400">
                Use either an audio file or pasted transcript. If both are
                provided, the pasted transcript is used.
              </p>
            </Field>

            <Field label="Transcript optional">
              <textarea
                name="transcript"
                rows={12}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Paste MaxoTel transcript here, or upload audio above..."
              />
            </Field>
          </section>

          <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Import and review call
          </button>
        </div>
      </form>
    </PageLayout>
  );
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
      assigned_reason: `Automatically assigned after MaxoTel call review: ${focus}`,
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
      source_type: "maxotel_manual_call_review",
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

function normaliseDatetimeLocal(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getDateDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}