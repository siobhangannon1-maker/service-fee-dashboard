import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import WorkbenchClient from "./WorkbenchClient";

function parseJsonMaybe(value: any) {
  if (!value) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function getImportedAttachments(item: any) {
  const attachmentDebug = parseJsonMaybe(item.attachment_debug);
  const importedAttachments = attachmentDebug?.imported_attachments;

  if (Array.isArray(importedAttachments)) {
    return importedAttachments;
  }

  if (item.file_path) {
    return [
      {
        name: item.file_name || "Document",
        size: null,
        bucket: "ai-reception",
        imported: true,
        content_type: "application/pdf",
        storage_path: item.file_path,
        fallback_from_file_path: true,
      },
    ];
  }

  return [];
}

function getLatestDraft(item: any) {
  const drafts = Array.isArray(item.ai_email_drafts)
    ? item.ai_email_drafts
    : [];

  return (
    drafts
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      )[0] || null
  );
}

function normaliseCaseWithLatestDecision(aiCase: any) {
  if (!aiCase) return null;

  const decisions = Array.isArray(aiCase.ai_decisions)
    ? aiCase.ai_decisions
    : [];

  const sortedDecisions = decisions
    .slice()
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    );

  const latestDecision = sortedDecisions[0] || null;

  return {
    ...aiCase,
    ai_decisions: sortedDecisions,
    latest_ai_decision: latestDecision,
    latest_decision: latestDecision?.decision || null,
  };
}

function getLatestCase(item: any) {
  const cases = Array.isArray(item.ai_cases) ? item.ai_cases : [];

  return (
    cases
      .map(normaliseCaseWithLatestDecision)
      .sort(
        (a: any, b: any) =>
          new Date(b?.updated_at || b?.created_at || 0).getTime() -
          new Date(a?.updated_at || a?.created_at || 0).getTime()
      )[0] || null
  );
}

export default async function AIReceptionWorkbenchPage() {
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
    .in("status", [
      "uploaded",
      "processing",
      "classified",
      "classification_failed",
    ])
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">AI Reception Workbench</h1>

        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error.message}
        </div>
      </main>
    );
  }

  const hydratedItems =
    data?.map((item: any) => {
      const latestDraft = getLatestDraft(item);
      const latestCase = getLatestCase(item);

      return {
        ...item,
        attachment_debug: parseJsonMaybe(item.attachment_debug),
        workbench_attachments: getImportedAttachments(item),

        ai_cases: latestCase ? [latestCase] : [],
        latest_ai_case: latestCase,
        latest_ai_decision: latestCase?.latest_ai_decision || null,
        latest_decision: latestCase?.latest_decision || null,

        draft_reply_subject:
          latestDraft?.subject || item.draft_reply_subject || null,
        draft_reply_body: latestDraft?.body || item.draft_reply_body || null,
        draft_status: latestDraft?.status || item.draft_status || null,
        email_status:
          item.email_status ||
          latestDraft?.status ||
          item.draft_status ||
          "drafted",
        outlook_draft_id:
          item.outlook_draft_id || latestDraft?.outlook_draft_id || null,
        outlook_message_id:
          item.outlook_message_id || latestDraft?.outlook_message_id || null,
        outlook_conversation_id:
          item.outlook_conversation_id ||
          latestDraft?.outlook_conversation_id ||
          null,
        outlook_web_link:
          item.outlook_web_link || latestDraft?.outlook_web_link || null,
        outlook_draft_created_at:
          item.outlook_draft_created_at ||
          latestDraft?.outlook_draft_created_at ||
          null,
        sent_detected_at:
          item.sent_detected_at || latestDraft?.sent_detected_at || null,
        sent_detection_method:
          item.sent_detection_method ||
          latestDraft?.sent_detection_method ||
          null,
        outlook_sent_message_id:
          item.outlook_sent_message_id ||
          latestDraft?.outlook_sent_message_id ||
          null,
        outlook_sent_web_link:
          item.outlook_sent_web_link ||
          latestDraft?.outlook_sent_web_link ||
          null,
      };
    }) || [];

  return <WorkbenchClient initialItems={hydratedItems} />;
}
