import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { parsePdfText } from "@/lib/pdf/parsePdf";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
  hasAttachments?: boolean;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
  body?: {
    contentType?: string;
    content?: string;
  };
};

type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  "@odata.type"?: string;
};

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

async function getMicrosoftGraphToken() {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Missing MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, or MICROSOFT_CLIENT_SECRET."
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("scope", "https://graph.microsoft.com/.default");
  body.set("grant_type", "client_credentials");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error_description || data?.error || "Could not get Graph token."
    );
  }

  return data.access_token as string;
}

async function graphFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Microsoft Graph request failed.");
  }

  return data as T;
}

async function uploadPdfToSupabase({
  messageId,
  fileName,
  buffer,
}: {
  messageId: string;
  fileName: string;
  buffer: Buffer;
}) {
  const safeFileName = sanitizeFileName(fileName || "attachment.pdf");
  const safeMessageId = messageId.replace(/[^a-zA-Z0-9.\-_]/g, "_");

  const filePath = `outlook/${safeMessageId}/${Date.now()}-${safeFileName}`;

  const { error } = await supabaseAdmin.storage
    .from("ai-reception")
    .upload(filePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message);
  }

  return filePath;
}

async function triggerPipelineStep({
  baseUrl,
  cookie,
  path,
  inboxItemId,
  text,
}: {
  baseUrl: string;
  cookie: string;
  path: string;
  inboxItemId: string;
  text?: string;
}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      id: inboxItemId,
      inboxItemId,
      text,
    }),
  });

  const responseText = await response.text();

  let data: any = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = { raw: responseText };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function runAiPipeline({
  baseUrl,
  cookie,
  inboxItemId,
  text,
}: {
  baseUrl: string;
  cookie: string;
  inboxItemId: string;
  text: string;
}) {
  const steps = [];

  const classify = await triggerPipelineStep({
    baseUrl,
    cookie,
    inboxItemId,
    text,
    path: "/api/ai-reception/classify",
  });

  steps.push({
    step: "classify",
    ok: classify.ok,
    status: classify.status,
    error: classify.ok ? null : classify.data?.error || classify.data,
  });

  const brain = await triggerPipelineStep({
    baseUrl,
    cookie,
    inboxItemId,
    text,
    path: "/api/ai/brain/analyse",
  });

  steps.push({
    step: "brain",
    ok: brain.ok,
    status: brain.status,
    error: brain.ok ? null : brain.data?.error || brain.data,
  });

  const patientMatch = await triggerPipelineStep({
    baseUrl,
    cookie,
    inboxItemId,
    text,
    path: "/api/ai/patient-match/run",
  });

  steps.push({
    step: "patient_match",
    ok: patientMatch.ok,
    status: patientMatch.status,
    error: patientMatch.ok
      ? null
      : patientMatch.data?.error || patientMatch.data,
  });

  return steps;
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const mailbox = process.env.OUTLOOK_SYNC_USER_EMAIL;
    const folder = process.env.OUTLOOK_SYNC_FOLDER || "inbox";

    if (!mailbox) {
      return NextResponse.json(
        { error: "Missing OUTLOOK_SYNC_USER_EMAIL." },
        { status: 500 }
      );
    }

    const baseUrl = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    const token = await getMicrosoftGraphToken();

    const messagesUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
        mailbox
      )}/mailFolders/${encodeURIComponent(folder)}/messages` +
      `?$top=10` +
      `&$orderby=receivedDateTime desc` +
      `&$select=id,conversationId,subject,bodyPreview,receivedDateTime,webLink,hasAttachments,from,body`;

    const messagesResponse = await graphFetch<{ value: GraphMessage[] }>(
      messagesUrl,
      token
    );

    const results: Array<{
      messageId: string;
      subject: string;
      status: "created" | "skipped" | "failed";
      inboxItemId?: string;
      pipeline?: any[];
      attachmentDebug?: any;
      error?: string;
    }> = [];

    for (const message of messagesResponse.value || []) {
      try {
        const { data: existing } = await supabaseAdmin
          .from("ai_inbox_items")
          .select("id")
          .eq("source_email_message_id", message.id)
          .maybeSingle();

        if (existing) {
          results.push({
            messageId: message.id,
            subject: message.subject || "(No subject)",
            status: "skipped",
            inboxItemId: existing.id,
          });
          continue;
        }

        const senderEmail = message.from?.emailAddress?.address || null;
        const senderName = message.from?.emailAddress?.name || null;

        const emailBody =
          message.body?.contentType?.toLowerCase() === "html"
            ? stripHtml(message.body?.content || "")
            : message.body?.content || message.bodyPreview || "";

        let firstPdfFileName: string | null = null;
        let firstPdfFilePath: string | null = null;
        let combinedAttachmentText = "";

        const attachmentDebug = {
          hasAttachments: Boolean(message.hasAttachments),
          attachmentsSeen: 0,
          pdfAttachmentsFound: 0,
          pdfAttachmentsUploaded: 0,
          pdfTextExtracted: 0,
          pdfTextCharacters: 0,
          pdfs: [] as Array<{
            name: string | null;
            contentType: string | null;
            size: number | null;
            uploaded: boolean;
            filePath: string | null;
            extractedCharacters: number;
            skippedReason?: string;
          }>,
        };

        if (message.hasAttachments) {
          const attachmentsUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
            mailbox
          )}/messages/${encodeURIComponent(message.id)}/attachments`;

          const attachmentsResponse = await graphFetch<{
            value: GraphAttachment[];
          }>(attachmentsUrl, token);

          for (const attachment of attachmentsResponse.value || []) {
            attachmentDebug.attachmentsSeen += 1;

            const isFileAttachment =
              attachment["@odata.type"] === "#microsoft.graph.fileAttachment";

            const isPdf =
              attachment.contentType === "application/pdf" ||
              attachment.name?.toLowerCase().endsWith(".pdf");

            if (isPdf) {
              attachmentDebug.pdfAttachmentsFound += 1;
            }

            if (!isFileAttachment) {
              attachmentDebug.pdfs.push({
                name: attachment.name || null,
                contentType: attachment.contentType || null,
                size: attachment.size || null,
                uploaded: false,
                filePath: null,
                extractedCharacters: 0,
                skippedReason: "Not a file attachment",
              });
              continue;
            }

            if (!isPdf) {
              continue;
            }

            if (attachment.isInline) {
              attachmentDebug.pdfs.push({
                name: attachment.name || null,
                contentType: attachment.contentType || null,
                size: attachment.size || null,
                uploaded: false,
                filePath: null,
                extractedCharacters: 0,
                skippedReason: "Inline attachment",
              });
              continue;
            }

            if (!attachment.contentBytes) {
              attachmentDebug.pdfs.push({
                name: attachment.name || null,
                contentType: attachment.contentType || null,
                size: attachment.size || null,
                uploaded: false,
                filePath: null,
                extractedCharacters: 0,
                skippedReason: "Missing contentBytes",
              });
              continue;
            }

            const pdfBuffer = Buffer.from(attachment.contentBytes, "base64");

            const filePath = await uploadPdfToSupabase({
              messageId: message.id,
              fileName: attachment.name || "attachment.pdf",
              buffer: pdfBuffer,
            });

            attachmentDebug.pdfAttachmentsUploaded += 1;

            const pdfText = await parsePdfText(pdfBuffer);
            const extractedCharacters = pdfText.length;

            if (extractedCharacters > 0) {
              attachmentDebug.pdfTextExtracted += 1;
              attachmentDebug.pdfTextCharacters += extractedCharacters;
            }

            attachmentDebug.pdfs.push({
              name: attachment.name || null,
              contentType: attachment.contentType || null,
              size: attachment.size || null,
              uploaded: true,
              filePath,
              extractedCharacters,
            });

            if (!firstPdfFileName) {
              firstPdfFileName = attachment.name || "attachment.pdf";
              firstPdfFilePath = filePath;
            }

            if (pdfText) {
              combinedAttachmentText += `\n\n--- PDF attachment: ${
                attachment.name || "attachment.pdf"
              } ---\n${pdfText}`;
            }
          }
        }
const hasUploadedPdf = attachmentDebug.pdfAttachmentsUploaded > 0;
const hasUsefulPdfText = attachmentDebug.pdfTextCharacters >= 100;

const attachmentNeedsOcr = hasUploadedPdf && !hasUsefulPdfText;

const attachmentExtractionStatus = !hasUploadedPdf
  ? "no_pdf"
  : hasUsefulPdfText
  ? "pdf_text_extracted"
  : "ocr_needed";

        const combinedText = [emailBody, combinedAttachmentText]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        const pipelineText =
          combinedText ||
          emailBody ||
          message.bodyPreview ||
          message.subject ||
          "";

        const { data: insertedItem, error: insertError } = await supabaseAdmin
          .from("ai_inbox_items")
          .insert({
            source_type: "email",
            source_email_provider: "outlook",
            source_email_message_id: message.id,
            source_email_thread_id: message.conversationId || null,
            source_email_url: message.webLink || null,

            subject: message.subject || null,
            body: emailBody || null,
            received_at: message.receivedDateTime || null,

            sender_email: senderEmail,
            sender_name: senderName,

            file_name: firstPdfFileName,
            file_path: firstPdfFilePath,

            raw_text: combinedText || emailBody || "",
            extracted_text: combinedText || emailBody || "",

            attachment_debug: attachmentDebug,
            attachment_extraction_status: attachmentExtractionStatus,
attachment_needs_ocr: attachmentNeedsOcr,

            status: "uploaded",
            category: "unknown",
            summary:
              message.bodyPreview ||
              message.subject ||
              "Outlook email imported for AI reception review.",
            suggested_action: "Review imported Outlook email.",
            email_status: "drafted",
            draft_status: "not_started",
            match_status: "not_checked",
          })
          .select()
          .single();

        if (insertError) {
          throw new Error(insertError.message);
        }

        const pipeline = await runAiPipeline({
          baseUrl,
          cookie,
          inboxItemId: insertedItem.id,
          text: pipelineText,
        });

        results.push({
          messageId: message.id,
          subject: message.subject || "(No subject)",
          status: "created",
          inboxItemId: insertedItem.id,
          pipeline,
          attachmentDebug,
        });
      } catch (messageError) {
        results.push({
          messageId: message.id,
          subject: message.subject || "(No subject)",
          status: "failed",
          error:
            messageError instanceof Error
              ? messageError.message
              : "Unknown message import error.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      mailbox,
      imported: results.filter((item) => item.status === "created").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    });
  } catch (error: any) {
    console.error("Outlook sync error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to sync Outlook emails." },
      { status: 500 }
    );
  }
}