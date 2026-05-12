import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { outlookSharedMailbox } from "@/lib/microsoft/graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getGraphAccessToken() {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, or MICROSOFT_CLIENT_SECRET.",
    );
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    },
  );

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.access_token) {
    throw new Error(
      json?.error_description || json?.error || "Could not get Microsoft Graph token.",
    );
  }

  return String(json.access_token);
}

async function sendOutlookDraftMessage({
  mailbox,
  messageId,
}: {
  mailbox: string;
  messageId: string;
}) {
  const accessToken = await getGraphAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    mailbox,
  )}/messages/${encodeURIComponent(messageId)}/send`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Microsoft Graph could not send the draft. Status ${response.status}. ${text.slice(
        0,
        500,
      )}`,
    );
  }

  return true;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);
    const body = await request.json();
    const inboxItemId = String(body.inboxItemId || "").trim();

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: itemError?.message || "Inbox item not found." },
        { status: 404 },
      );
    }

    const draftId = item.outlook_draft_id || item.outlook_message_id;

    if (!draftId) {
      return NextResponse.json(
        { error: "No Outlook draft exists for this item yet." },
        { status: 400 },
      );
    }

    if (item.email_status === "sent" || item.sent_at) {
      return NextResponse.json(
        { error: "This item already appears to be sent." },
        { status: 400 },
      );
    }

    await sendOutlookDraftMessage({
      mailbox: outlookSharedMailbox,
      messageId: draftId,
    });

    const now = new Date().toISOString();

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        email_status: "sent",
        draft_status: "sent",
        sent_at: now,
        sent_detected_at: now,
        sent_detection_method: "send_outlook_draft_button",
        outlook_sent_message_id: draftId,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabaseAdmin
      .from("ai_email_drafts")
      .update({
        status: "sent",
        sent_at: now,
        sent_detected_at: now,
        sent_detection_method: "send_outlook_draft_button",
        updated_at: now,
      })
      .eq("inbox_item_id", inboxItemId);

    const { error: auditError } = await supabaseAdmin
      .from("ai_workbench_audit_events")
      .insert({
        inbox_item_id: inboxItemId,
        event_type: "outlook_draft_sent",
        event_label: "Outlook draft sent",
        actor_user_id: user.id,
        actor_email: user.email || null,
        details: {
          mailbox: outlookSharedMailbox,
          outlook_draft_id: draftId,
          sent_at: now,
        },
      });

    if (auditError) {
      console.error("Send Outlook draft audit insert failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      item: updatedItem,
      auditInserted: !auditError,
      auditError: auditError?.message || null,
    });
  } catch (error: any) {
    console.error("Send Outlook draft error:", error);

    return NextResponse.json(
      { error: error?.message || "Failed to send Outlook draft." },
      { status: 500 },
    );
  }
}
