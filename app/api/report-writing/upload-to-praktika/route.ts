import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPraktikaHelperJob } from "@/lib/praktika/helper-jobs";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";
const HELPER_UPLOAD_BUCKET =
  process.env.PRAKTIKA_HELPER_UPLOAD_BUCKET || "praktika-helper-files";

function getSafePatientName(patientName: string | null | undefined) {
  return patientName
    ? String(patientName)
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
    : "Patient";
}

function getFileDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatPraktikaDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function appUserIdFromMode(
  mode: Awaited<ReturnType<typeof getCurrentUserPraktikaSessionMode>>,
) {
  return mode.scope === "user" ? mode.appUserId : null;
}

async function ensureUploadBucketExists() {
  const { data: buckets, error } = await supabase.storage.listBuckets();

  if (error) {
    throw new Error(`Could not check Supabase Storage buckets: ${error.message}`);
  }

  const exists = buckets?.some((bucket) => bucket.name === HELPER_UPLOAD_BUCKET);

  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(
    HELPER_UPLOAD_BUCKET,
    {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024,
    },
  );

  if (createError) {
    throw new Error(
      `Could not create Supabase Storage bucket ${HELPER_UPLOAD_BUCKET}: ${createError.message}`,
    );
  }
}

async function verifyStagedUploadExists(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(HELPER_UPLOAD_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(
      `PDF was staged for Praktika, but Supabase Storage could not read it back: ${
        error?.message || "No file returned."
      }`,
    );
  }

  const size = data.size;

  if (!size || size < 1000) {
    throw new Error(
      `PDF was staged for Praktika, but the stored file looks empty or invalid. Size: ${
        size || 0
      } bytes.`,
    );
  }

  return true;
}

export async function POST(req: Request) {
  let storagePath: string | null = null;
  let helperJobId: string | null = null;

  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json();
    const { draftId, praktikaPatientId, notes } = body;

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 },
      );
    }

    if (!praktikaPatientId) {
      return NextResponse.json(
        { success: false, error: "Missing Praktika patient ID." },
        { status: 400 },
      );
    }

    const actor = await getAuditActor();

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 },
      );
    }

    if (draft.status !== "approved" && draft.status !== "uploaded_to_praktika") {
      return NextResponse.json(
        {
          success: false,
          error: "Only approved reports can be uploaded to Praktika.",
        },
        { status: 400 },
      );
    }

    const origin = new URL(req.url).origin;

    const pdfResponse = await fetch(`${origin}/api/report-writing/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();

      return NextResponse.json(
        {
          success: false,
          error: "Failed to generate PDF before Praktika upload.",
          details: errorText.slice(0, 1000),
        },
        { status: 500 },
      );
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());

    if (!pdfBuffer.length || pdfBuffer.length < 1000) {
      throw new Error(
        `Generated PDF looks empty or invalid. Size: ${pdfBuffer.length} bytes.`,
      );
    }

    const fileName = `${getFileDate()} ${getSafePatientName(
      draft.patient_name,
    )} Letter.pdf`;

    await ensureUploadBucketExists();

    storagePath = `report-uploads/${
      mode.scope === "user" ? mode.appUserId : "practice"
    }/${draftId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(HELPER_UPLOAD_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(
        `Could not stage PDF for Praktika helper: ${uploadError.message}`,
      );
    }

    await verifyStagedUploadExists(storagePath);

    const helperJob = await createPraktikaHelperJob({
      appUserId: appUserIdFromMode(mode),
      jobType: "upload_report_to_praktika",
      priority: 20,
      request: {
        method: "POST",
        path: "/php/forms/db_updateFormData.php",
        contentType: "multipart_storage",
        referer: `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
        body: {
          fields: {
            practice_id: PRAKTIKA_PRACTICE_ID,
            patient_id: String(praktikaPatientId),
            "patient_communication[typeId]": "3",
            "patient_communication[file][direction]": "2",
            "patient_communication[file][name]": fileName,
            "patient_communication[file][notes]":
              notes ||
              `Report sent via Mediref for ${draft.patient_name || "patient"}.`,
            "patient_communication[file][modifiedDate]":
              formatPraktikaDateTime(),
          },
          file: {
            bucket: HELPER_UPLOAD_BUCKET,
            path: storagePath,
            fieldName: "patient_communication[file][file]",
            fileName,
            contentType: "application/pdf",
          },
        },
      },
    });

    helperJobId = helperJob.id;

    const now = new Date().toISOString();

    const { data: updatedDraft, error: updateError } = await supabase
      .from("report_drafts")
      .update({
        uploaded_to_praktika: true,
        uploaded_to_praktika_at: now,
        uploaded_by_initials: actor.actorInitials,
        uploaded_by_name: actor.actorFullName,
        praktika_patient_id: String(praktikaPatientId),
        status: "uploaded_to_praktika",
        updated_at: now,
      })
      .eq("id", draftId)
      .select()
      .single();

    if (updateError) {
      console.error(
        "Praktika upload was queued, but failed to update report status:",
        updateError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Praktika upload was queued, but failed to update report status.",
          details: updateError.message,
          helperJobId: helperJob.id,
        },
        { status: 500 },
      );
    }

    await createReportAuditEvent({
      reportDraftId: draft.id,
      providerId: draft.provider_id,
      patientName: draft.patient_name,
      action: "Queued report upload to Praktika",
      details: {
        praktikaPatientId,
        fileName,
        status: updatedDraft.status,
        uploadedByInitials: actor.actorInitials,
        uploadedByName: actor.actorFullName,
        helperJobId: helperJob.id,
        stagedPdf: {
          bucket: HELPER_UPLOAD_BUCKET,
          storagePath,
          fileName,
          contentType: "application/pdf",
        },
      },
    });

    return NextResponse.json({
      success: true,
      queued: true,
      message: "Report upload to Praktika has been queued.",
      fileName,
      uploadedByInitials: actor.actorInitials,
      uploadedByName: actor.actorFullName,
      helperJobId: helperJob.id,
      stagedPdf: {
        bucket: HELPER_UPLOAD_BUCKET,
        storagePath,
        fileName,
        contentType: "application/pdf",
      },
    });
  } catch (error) {
    console.error("Upload report to Praktika failed:", error);

    if (storagePath && !helperJobId) {
      await supabase.storage
        .from(HELPER_UPLOAD_BUCKET)
        .remove([storagePath])
        .catch(() => null);
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload report to Praktika.",
      },
      { status: 500 },
    );
  }
}