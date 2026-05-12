import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { archiveOutlookMessage, outlookSharedMailbox } from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function workflowFilingLooksComplete(item: any) {
  if (item.praktika_filing_status === "completed") return true;

  const workflowResult = item.referral_workflow_result || {};
  const filingResult = workflowResult.filingResult || {};

  return (
    item.referral_workflow_status === "completed" &&
    (filingResult.ok === true || Boolean(filingResult.filedAt))
  );
}

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const archiveOutlook = body.archiveOutlook !== false;

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const { data: item, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (error || !item) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Inbox item not found." },
        { status: 404 },
      );
    }

    const blockers: string[] = [];

    if (item.archived_at) blockers.push("Already archived.");
    if (!item.praktika_patient_id) blockers.push("No Praktika patient.");
    if (!workflowFilingLooksComplete(item)) {
      blockers.push("Attachments have not been filed.");
    }
    if (!item.praktika_referral_id) blockers.push("No Praktika referral created.");
    if (
      item.classification_v2_requires_clinical_review === true ||
      item.workflow_kind === "urgent_clinical"
    ) {
      blockers.push("Clinical review is required.");
    }

    if (blockers.length > 0) {
      return NextResponse.json(
        { ok: false, status: "blocked", blockers },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    let outlookArchiveResult: any = null;
    let outlookArchiveError: string | null = null;

    if (archiveOutlook && item.source_email_message_id) {
      try {
        outlookArchiveResult = await archiveOutlookMessage({
          mailbox: outlookSharedMailbox,
          messageId: item.source_email_message_id,
        });
      } catch (error: any) {
        outlookArchiveError = error?.message || "Outlook archive failed.";
      }
    }

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        archived_at: now,
        archived_by: user?.id || null,
        archive_reason: "Completed referral workflow archived automatically.",
        status: "archived",
        praktika_filing_status: item.praktika_filing_status || "completed",
        praktika_filed_at: item.praktika_filed_at || now,
        praktika_filing_error: null,
        outlook_archive_status: outlookArchiveError
          ? "failed"
          : outlookArchiveResult
            ? "archived"
            : "skipped",
        outlook_archive_error: outlookArchiveError,
        outlook_archived_at: outlookArchiveResult ? now : null,
        outlook_archive_result: outlookArchiveResult || {},
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 },
      );
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "completed_referral_auto_archived",
      event_label: "Completed referral item archived",
      actor_user_id: user?.id || null,
      actor_email: user?.email || null,
      details: {
        archived_at: now,
        reason: "Completed referral workflow archived automatically.",
        outlookArchiveResult,
        outlookArchiveError,
      },
    });

    return NextResponse.json({
      ok: true,
      item: updatedItem,
      outlookArchiveResult,
      outlookArchiveError,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Archive completed referral failed." },
      { status: 500 },
    );
  }
}
