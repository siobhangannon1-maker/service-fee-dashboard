import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

import AIAnalyseButton from "@/components/ai/AIAnalyseButton";
import ConfirmPatientMatchButton from "@/components/ai/ConfirmPatientMatchButton";
import DraftGuidancePanel from "@/components/ai/DraftGuidancePanel";
import RunPatientMatchButton from "@/components/ai/RunPatientMatchButton";

export default async function InboxPage() {
  await requireRole(["super_admin"]);

  const { data, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(`
      *,
      ai_cases (
        *,
        ai_decisions (*)
      ),
      ai_patient_match_candidates (
        *,
        patients (*)
      ),
      ai_email_drafts (
        *
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="mb-4 text-xl font-semibold">AI Inbox</h1>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  const hydratedItems =
    data?.map((item) => {
      const latestDraft =
        item.ai_email_drafts
          ?.slice()
          .sort(
            (a: any, b: any) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          )[0] || null;

      return {
        ...item,
        latestDraft,
      };
    }) || [];

  return (
    <main className="p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Inbox
          </h1>

          <p className="mt-1 text-sm text-slate-600">
            Uploaded referrals, letters, x-rays and patient correspondence.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href="/ai/brain"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View AI Brain
          </a>

          <a
            href="/ai-reception/upload"
            className="rounded-2xl bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload correspondence
          </a>
        </div>
      </div>

      {!hydratedItems || hydratedItems.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No correspondence has been uploaded yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {hydratedItems.map((item) => {
            const aiCase = item.ai_cases?.[0];
            const latestDecision = aiCase?.ai_decisions?.[0];
            const latestDraft = item.latestDraft;

            const confirmedMatch =
              item.ai_patient_match_candidates?.find(
                (match: any) => match.status === "confirmed"
              ) || null;

            return (
              <div
                key={item.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {item.file_name ||
                        item.subject ||
                        item.sender_email ||
                        "Untitled item"}
                    </div>

                    <div className="mt-2 grid gap-1 text-sm text-slate-600">
                      <div>Status: {item.status || "pending"}</div>

                      <div>
                        Category: {item.category || "Not classified yet"}
                      </div>

                      <div>
                        Patient: {item.patient_name || "Not detected yet"}
                      </div>

                      <div>DOB: {item.patient_dob || "Not detected yet"}</div>

                      <div>
                        Match:{" "}
                        {item.match_status ||
                          confirmedMatch?.status ||
                          "not checked"}
                      </div>

                      {latestDraft ? (
                        <div>Draft status: {latestDraft.status || "draft"}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    {item.status || "pending"}
                  </div>
                </div>

                {item.summary ? (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                    {item.summary}
                  </div>
                ) : null}

                {item.suggested_action ? (
                  <div className="mt-3 text-sm text-slate-700">
                    <span className="font-medium">Suggested action:</span>{" "}
                    {item.suggested_action}
                  </div>
                ) : null}

                {aiCase ? (
                  <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold">AI Brain Result</p>

                        <p className="mt-1 text-xs text-indigo-700">
                          Case-level risk, confidence and next step.
                        </p>
                      </div>

                      <div className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700">
                        Risk: {aiCase.risk_level || "unknown"}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-1">
                      <div>
                        <span className="font-medium">Brain category:</span>{" "}
                        {aiCase.category || "unknown"}
                      </div>

                      <div>
                        <span className="font-medium">Confidence:</span>{" "}
                        {aiCase.confidence ?? "—"}
                      </div>

                      <div>
                        <span className="font-medium">
                          Recommended next step:
                        </span>{" "}
                        {aiCase.recommended_next_step || "No recommendation"}
                      </div>
                    </div>

                    {latestDecision?.explanation ? (
                      <div className="mt-3 rounded-xl bg-white/80 p-3">
                        <p className="font-medium">Why the AI thinks this</p>

                        <p className="mt-1">{latestDecision.explanation}</p>
                      </div>
                    ) : null}

                    {latestDecision?.risks?.length ? (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                        <p className="font-medium">Risks detected</p>

                        <ul className="mt-2 list-disc pl-5">
                          {latestDecision.risks.map(
                            (risk: string, index: number) => (
                              <li key={index}>{risk}</li>
                            )
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-900">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">Patient Match Engine</p>

                      <p className="mt-1 text-xs text-purple-700">
                        Match uploaded correspondence against existing patients.
                      </p>
                    </div>

                    <RunPatientMatchButton inboxItemId={item.id} />
                  </div>

                  {confirmedMatch ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">
                            Confirmed patient match
                          </p>

                          <p className="mt-1 text-sm">
                            {confirmedMatch.patients?.full_name ||
                              "Unknown patient"}
                          </p>

                          <p className="text-sm">
                            DOB:{" "}
                            {confirmedMatch.patients?.date_of_birth ||
                              "Unknown"}
                          </p>
                        </div>

                        <div className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                          {Math.round((confirmedMatch.confidence || 0) * 100)}%
                          confidence
                        </div>
                      </div>

                      <p className="mt-3 text-sm">
                        {confirmedMatch.match_reason || "Confirmed by user."}
                      </p>
                    </div>
                  ) : null}

                  {item.ai_patient_match_candidates?.length ? (
                    <div className="mt-4 space-y-3">
                      {item.ai_patient_match_candidates.map((match: any) => {
                        const isConfirmed = match.status === "confirmed";
                        const isRejected = match.status === "rejected";

                        return (
                          <div
                            key={match.id}
                            className={`rounded-2xl border p-4 ${
                              isConfirmed
                                ? "border-emerald-200 bg-emerald-50"
                                : isRejected
                                ? "border-slate-200 bg-slate-50 opacity-70"
                                : "border-purple-100 bg-white"
                            }`}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="font-medium text-slate-900">
                                  {match.patients?.full_name ||
                                    "Unknown patient"}
                                </div>

                                <div className="mt-1 text-sm text-slate-600">
                                  DOB:{" "}
                                  {match.patients?.date_of_birth || "Unknown"}
                                </div>

                                <div className="mt-1 text-xs text-slate-500">
                                  Status: {match.status || "suggested"}
                                </div>
                              </div>

                              <div className="flex flex-col items-start gap-2 sm:items-end">
                                <div className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                                  {Math.round((match.confidence || 0) * 100)}%
                                  confidence
                                </div>

                                {!isConfirmed && !isRejected ? (
                                  <ConfirmPatientMatchButton
                                    inboxItemId={item.id}
                                    matchCandidateId={match.id}
                                  />
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 text-sm text-slate-700">
                              {match.match_reason || "No reasoning saved."}
                            </div>

                            {match.matched_fields?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {match.matched_fields.map(
                                  (field: string, index: number) => (
                                    <span
                                      key={index}
                                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                    >
                                      {field}
                                    </span>
                                  )
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-purple-700">
                      No patient matches found yet.
                    </p>
                  )}
                </div>

                <DraftGuidancePanel
                  guidance={latestDraft?.guidance}
                  description="AI memory, examples and safety checks used while generating the latest receptionist draft."
                />

                {latestDraft ? (
                  <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Latest Draft
                    </h3>

                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Subject
                      </p>

                      <p className="mt-1 text-sm text-slate-800">
                        {latestDraft.subject || "No subject"}
                      </p>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Draft body
                      </p>

                      <div className="mt-2 whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm text-slate-700">
                        {latestDraft.body || "No draft body"}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <AIAnalyseButton
                    inboxItemId={item.id}
                    subject={item.subject}
                    senderName={item.sender_name}
                    senderEmail={item.sender_email}
                    emailBody={
                      item.body ||
                      item.email_body ||
                      item.raw_text ||
                      item.extracted_text ||
                      item.summary ||
                      ""
                    }
                    existingCategory={item.category}
                    patientName={item.patient_name}
                    patientDob={item.patient_dob}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}