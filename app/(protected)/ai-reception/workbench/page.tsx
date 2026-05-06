import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import WorkbenchClient from "./WorkbenchClient";

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
      };
    }) || [];

  return <WorkbenchClient initialItems={hydratedItems} />;
}