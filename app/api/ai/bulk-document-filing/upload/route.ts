import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET || "ai-reception";

function getExtension(fileName: string) {
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "bin";
}

function getWorkflowDocumentType(file: File) {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";

  return "unknown";
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-()[\] ]+/g, "_");
}

function getNameFromAuthResult(authResult: any) {
  return (
    authResult?.profile?.full_name ||
    authResult?.profile?.name ||
    authResult?.user?.user_metadata?.full_name ||
    authResult?.user?.user_metadata?.name ||
    authResult?.user?.email ||
    authResult?.email ||
    "Unknown user"
  );
}

function getEmailFromAuthResult(authResult: any) {
  return (
    authResult?.user?.email ||
    authResult?.profile?.email ||
    authResult?.email ||
    null
  );
}

function getUserIdFromAuthResult(authResult: any) {
  return authResult?.user?.id || authResult?.profile?.id || authResult?.id || null;
}

export async function POST(request: Request) {
  try {
    const authResult = await requireRole(["super_admin"]);

    const uploaderId = getUserIdFromAuthResult(authResult);
    const uploaderEmail = getEmailFromAuthResult(authResult);
    const uploaderName = getNameFromAuthResult(authResult);

    const formData = await request.formData();
    const files = formData.getAll("files").filter(Boolean) as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No files uploaded." },
        { status: 400 },
      );
    }

    const batchId = randomUUID();
    const createdItems: any[] = [];

    for (const file of files) {
      const extension = getExtension(file.name);
      const originalName = file.name;
      const cleanName = safeFileName(file.name);

      const storagePath = `bulk-document-filing/${batchId}/${randomUUID()}.${extension}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(
          `Failed to upload ${originalName}: ${uploadError.message}`,
        );
      }

      const attachmentDebug = {
        imported_attachments: [
          {
            name: cleanName,
            original_name: originalName,
            content_type: file.type || "application/octet-stream",
            storage_path: storagePath,
            bucket: BUCKET,
            size: file.size,
          },
        ],
        bulk_upload_batch_id: batchId,
        source: "bulk_document_filing",
        uploaded_by: {
          id: uploaderId,
          email: uploaderEmail,
          name: uploaderName,
        },
      };

      const { data: item, error: insertError } = await supabaseAdmin
        .from("ai_inbox_items")
        .insert({
          file_name: cleanName,
          file_path: storagePath,
          source: "bulk_document_upload",
          source_type: "manual_bulk_upload",
          status: "pending",
          category: "bulk_document_filing",
          workflow_kind: "bulk_patient_document_filing",
          workflow_document_type: getWorkflowDocumentType(file),
          attachment_debug: attachmentDebug,
          attachment_extraction_status: "not_checked",
          attachment_needs_ocr: true,
          praktika_match_status: "not_checked",
          praktika_filing_status: "pending",
          bulk_upload_batch_id: batchId,
          bulk_uploaded_by: uploaderId,
          bulk_uploaded_by_email: uploaderEmail,
          bulk_uploaded_by_name: uploaderName,
          summary: `Bulk uploaded document: ${cleanName}`,
        })
        .select("*")
        .single();

      if (insertError) {
        throw new Error(
          `Failed to create inbox item for ${originalName}: ${insertError.message}`,
        );
      }

      createdItems.push(item);
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      actor_id: uploaderId,
      event_type: "bulk_document_upload_batch_created",
      event_label: "Bulk document upload batch created",
      details: {
        batchId,
        fileCount: createdItems.length,
        uploadedBy: {
          id: uploaderId,
          email: uploaderEmail,
          name: uploaderName,
        },
        files: createdItems.map((item) => ({
          id: item.id,
          file_name: item.file_name,
          file_path: item.file_path,
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      batchId,
      items: createdItems,
    });
  } catch (error: any) {
    console.error("Bulk document upload failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Bulk document upload failed.",
      },
      { status: 500 },
    );
  }
}