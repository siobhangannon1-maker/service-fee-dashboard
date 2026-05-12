import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  uploadPatientCommunicationFile,
  uploadPatientImageFile,
  createPatientClinicalNote,
} from "@/lib/praktika/patient-filing";

type ImportedAttachment = {
  name?: string;
  content_type?: string;
  storage_path?: string;
  bucket?: string;
  size?: number;
};

function parseMaybeJson(value: any) {
  if (!value) return value;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getImportedAttachments(attachmentDebug: any): ImportedAttachment[] {
  const parsed = parseMaybeJson(attachmentDebug);

  if (Array.isArray(parsed?.imported_attachments)) {
    return parsed.imported_attachments.filter(
      (attachment: ImportedAttachment) => attachment?.storage_path,
    );
  }

  return [];
}

function isPdfAttachment(attachment: ImportedAttachment) {
  const contentType = String(attachment.content_type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();
  return contentType.includes("pdf") || name.endsWith(".pdf");
}

function isImageAttachment(attachment: ImportedAttachment) {
  const contentType = String(attachment.content_type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();

  return (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)
  );
}

async function downloadAttachment(attachment: ImportedAttachment) {
  const bucket =
    attachment.bucket ||
    process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET ||
    "ai-reception";

  if (!attachment.storage_path) {
    throw new Error(`Missing storage path for ${attachment.name || "attachment"}`);
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(attachment.storage_path);

  if (error) {
    throw new Error(`Failed to download ${attachment.name}: ${error.message}`);
  }

  return data;
}

function buildAiActionNote({
  item,
  filedPdfs,
  filedImages,
  skipped,
}: {
  item: any;
  filedPdfs: string[];
  filedImages: string[];
  skipped: string[];
}) {
  const isNewPatient = item.praktika_match_status === "created_new_patient";

  const lines = [
    "AI ACTION LOG",
    "",
    `Email received: ${item.received_at || item.created_at || "Unknown"}`,
    `Workflow: ${item.workflow_kind || "Unknown"}`,
    `Summary: ${item.summary || "No summary available."}`,
    "",
    "Actions completed:",
  ];

  if (isNewPatient) {
    lines.push("- New Praktika patient file created");
  } else {
    lines.push("- Existing Praktika patient match confirmed");
  }

  if (item.praktika_referral_id) {
    lines.push(`- Referral record created: ${item.praktika_referral_id}`);
  } else {
    lines.push("- Referral record: not created or not yet linked");
  }

  if (item.trello_card_url) {
    lines.push(`- Trello task created: ${item.trello_card_url}`);
  } else if (item.reception_trello_card_url) {
    lines.push(`- Reception Trello task created: ${item.reception_trello_card_url}`);
  } else {
    lines.push("- Trello task: not created or not required");
  }

  if (item.draft_reply_subject || item.draft_reply_body) {
    lines.push("- Reply drafted");
  } else {
    lines.push("- Reply draft: not created or not required");
  }

  for (const file of filedPdfs) {
    lines.push(`- PDF/document added to patient Communications: ${file}`);
  }

  for (const file of filedImages) {
    lines.push(`- Image added to patient Images: ${file}`);
  }

  for (const file of skipped) {
    lines.push(`- Skipped unsupported attachment: ${file}`);
  }

  lines.push("");
  lines.push("Filed by DocuDental assisted automation.");

  return lines.join("\n");
}

export async function autoFileInboxItemToPraktika({
  inboxItemId,
  force = false,
}: {
  inboxItemId: string;
  force?: boolean;
}) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  if (!item.praktika_patient_id) {
    throw new Error(
      "No Praktika patient selected. Confirm or create a patient before filing.",
    );
  }

  if (item.praktika_filing_status === "completed" && !force) {
    return {
      ok: true,
      skipped: true,
      reason: "Already filed to Praktika.",
      existingResult: item.praktika_filing_result,
    };
  }

  const attachments = getImportedAttachments(item.attachment_debug);

  if (attachments.length === 0) {
    throw new Error("No imported attachments found to file to Praktika.");
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      praktika_filing_status: "running",
      praktika_filing_started_at: new Date().toISOString(),
      praktika_filing_error: null,
    })
    .eq("id", inboxItemId);

  const communicationResults: any[] = [];
  const imageResults: any[] = [];
  const skippedAttachments: string[] = [];
  const filedPdfs: string[] = [];
  const filedImages: string[] = [];

  try {
    for (const attachment of attachments) {
      const fileName = attachment.name || "attachment";
      const fileBlob = await downloadAttachment(attachment);

      if (isPdfAttachment(attachment)) {
        const result = await uploadPatientCommunicationFile({
          patientId: item.praktika_patient_id,
          file: fileBlob,
          fileName,
          notes: `Filed by DocuDental from inbox item ${inboxItemId}.`,
        });

        communicationResults.push({ fileName, result });
        filedPdfs.push(fileName);
        continue;
      }

      if (isImageAttachment(attachment)) {
        const result = await uploadPatientImageFile({
          patientId: item.praktika_patient_id,
          file: fileBlob,
          fileName,
          notes: `Filed by DocuDental from inbox item ${inboxItemId}.`,
        });

        imageResults.push({ fileName, result });
        filedImages.push(fileName);
        continue;
      }

      skippedAttachments.push(fileName);
    }

    const noteText = buildAiActionNote({
      item,
      filedPdfs,
      filedImages,
      skipped: skippedAttachments,
    });

    const noteResult = await createPatientClinicalNote({
      patientId: item.praktika_patient_id,
      text: noteText,
      author: "AI",
    });

    const communicationIds = communicationResults
      .map((entry) => entry.result?.patient_communication?.iFileId ?? null)
      .filter(Boolean);

    const imageIds = imageResults
      .flatMap((entry) =>
        Array.isArray(entry.result?.patient_images)
          ? entry.result.patient_images.map((image: any) => image.id)
          : [],
      )
      .filter(Boolean);

    const noteId =
      Array.isArray(noteResult?.patient_clinicalnotes) &&
      noteResult.patient_clinicalnotes[0]?.id
        ? String(noteResult.patient_clinicalnotes[0].id)
        : null;

    const filingResult = {
      patientId: item.praktika_patient_id,
      inboxItemId,
      communicationResults,
      imageResults,
      skippedAttachments,
      noteResult,
      filedAt: new Date().toISOString(),
    };

    const { data: updatedItem } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_filing_status: "completed",
        praktika_filed_at: new Date().toISOString(),
        praktika_filing_error: null,
        praktika_filed_communication_ids: communicationIds,
        praktika_filed_image_ids: imageIds,
        praktika_filed_note_id: noteId,
        praktika_filing_result: filingResult,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "praktika_auto_file_completed",
      event_label: "Filed attachments and AI note to Praktika",
      details: filingResult,
    });

    return {
      ok: true,
      ...filingResult,
      item: updatedItem || null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Praktika filing failed.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_filing_status: "failed",
        praktika_filing_error: message,
      })
      .eq("id", inboxItemId);

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "praktika_auto_file_failed",
      event_label: "Praktika filing failed",
      details: { error: message },
    });

    throw error;
  }
}