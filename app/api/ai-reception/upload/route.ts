import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractPdfTextFromFile } from "@/lib/ai-reception/extract-pdf-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "ai-reception";

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 160);
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const fileExt = file.name.split(".").pop()?.toLowerCase() || "file";
    const safeOriginalName = sanitizeFileName(file.name);
    const filePath = `uploads/${crypto.randomUUID()}-${safeOriginalName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const isPdf = file.type === "application/pdf" || fileExt === "pdf";

    let extractedText = file.name;
    let extractedCharacters = 0;

    if (isPdf) {
      const parsedText = await extractPdfTextFromFile(file);
      extractedCharacters = parsedText?.trim().length || 0;

      if (extractedCharacters > 0) {
        extractedText = `--- PDF attachment: ${file.name} ---\n${parsedText}`;
      } else {
        extractedText = `No selectable PDF text was found. Filename: ${file.name}`;
      }
    }

    const attachmentNeedsOcr = isPdf && extractedCharacters < 100;

    const attachmentExtractionStatus = !isPdf
      ? "not_pdf"
      : extractedCharacters >= 100
      ? "pdf_text_extracted"
      : "ocr_needed";

    const attachmentDebug = {
      source: "manual_upload",
      originalFileName: file.name,
      storedFilePath: filePath,
      contentType: file.type || null,
      size: file.size || null,
      isPdf,
      extractedCharacters,
      attachmentNeedsOcr,
      attachmentExtractionStatus,
    };

    const { data: inboxItem, error: insertError } = await supabaseAdmin
      .from("ai_inbox_items")
      .insert({
        source_type: "manual_upload",

        file_name: file.name,
        file_path: filePath,

        status: "processing",
        category: "unknown",

        raw_text: extractedText,
        extracted_text: extractedText,

        attachment_debug: attachmentDebug,
        attachment_extraction_status: attachmentExtractionStatus,
        attachment_needs_ocr: attachmentNeedsOcr,

        summary: "Manual correspondence uploaded for AI reception review.",
        suggested_action: attachmentNeedsOcr
          ? "Review this item. OCR may be needed because little PDF text was extracted."
          : "Review uploaded correspondence.",

        email_status: "drafted",
        draft_status: "not_started",
        match_status: "not_checked",
      })
      .select()
      .single();

    if (insertError || !inboxItem) {
      return NextResponse.json(
        { error: insertError?.message || "Database insert failed" },
        { status: 500 }
      );
    }

    const classifyUrl = new URL("/api/ai-reception/classify", req.url);

    const classifyResponse = await fetch(classifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        id: inboxItem.id,
        inboxItemId: inboxItem.id,
        text: extractedText.slice(0, 15000),
      }),
    });

    if (!classifyResponse.ok) {
      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          status: "classification_failed",
          extracted_text: extractedText,
        })
        .eq("id", inboxItem.id);

      return NextResponse.json(
        {
          error: "Upload succeeded but classification failed.",
          inboxItemId: inboxItem.id,
          item: inboxItem,
        },
        { status: 500 }
      );
    }

    const classifyResult = await classifyResponse.json().catch(() => null);

    const brainUrl = new URL("/api/ai/brain/analyse", req.url);

    const brainResponse = await fetch(brainUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        inboxItemId: inboxItem.id,
        subject: inboxItem.file_name,
        emailBody: extractedText.slice(0, 15000),
        existingCategory: classifyResult?.category || null,
        patientName: classifyResult?.patient_name || null,
        patientDob: classifyResult?.patient_dob || null,
      }),
    });

    const brainResult = await brainResponse.json().catch(() => null);

    if (!brainResponse.ok) {
      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          status: "classified",
          extracted_text: extractedText,
        })
        .eq("id", inboxItem.id);

      return NextResponse.json({
        success: true,
        warning:
          "Upload and classification succeeded, but AI Brain analysis did not run.",
        brainError: brainResult?.error || "AI Brain failed.",
        inboxItemId: inboxItem.id,
        item: inboxItem,
        classification: classifyResult,
      });
    }

    const patientMatchUrl = new URL("/api/ai/patient-match/run", req.url);

    const patientMatchResponse = await fetch(patientMatchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        inboxItemId: inboxItem.id,
      }),
    });

    const patientMatchResult = await patientMatchResponse
      .json()
      .catch(() => null);

    return NextResponse.json({
      success: true,
      inboxItemId: inboxItem.id,
      item: inboxItem,
      classification: classifyResult,
      brain: brainResult,
      patientMatch: patientMatchResult,
      patientMatchWarning: patientMatchResponse.ok
        ? null
        : patientMatchResult?.error || "Patient matching did not run.",
    });
  } catch (err) {
    console.error("Upload correspondence error:", err);

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}