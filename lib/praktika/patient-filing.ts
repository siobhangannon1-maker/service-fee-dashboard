import "server-only";

import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";
import { type PraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";
const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";

type UploadPatientFileInput = {
  patientId: string | number;
  file: Blob | File;
  fileName: string;
  description?: string;
  mode?: PraktikaSessionMode;
};

function formatPraktikaDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function makeRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function getPatientClinicalNotes({
  patientId,
  mode,
}: {
  patientId: string | number;
  mode: PraktikaSessionMode;
}) {
  return await praktikaHelperPost<any>({
    mode,
    jobType: "get_patient_clinical_notes",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer: `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
    priority: 40,
    body: [
      {
        parameters: [
          {
            practice_id: Number(PRAKTIKA_PRACTICE_ID),
            patient_id: String(patientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });
}

export async function createPatientClinicalNote({
  patientId,
  text,
  author = "AI",
  mode,
}: {
  patientId: string | number;
  text: string;
  author?: string;
  mode: PraktikaSessionMode;
}) {
  const now = new Date();
  const dateTime = `${formatPraktikaDateTime(now)}:00`;
  const tempId = `-${Date.now()}`;

  return await praktikaHelperPost<any>({
    mode,
    jobType: "create_patient_clinical_note",
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
    referer: `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
    priority: 30,
    body: [
      {
        request_id: makeRequestId("clinical_note"),
        practice_id: Number(PRAKTIKA_PRACTICE_ID),
        patient_id: Number(patientId),
        patient_clinicalnotes: [
          {
            id: tempId,
            oldid: null,
            previd: null,
            author,
            date: dateTime,
            type: 2,
            teeth: null,
            draft: false,
            text,
            editable: true,
            deleted: false,
            rootid: tempId,
            appointmentid: null,
            dateOverride: null,
            dateCreated: dateTime,
            history: [],
          },
        ],
      },
    ],
  });
}

export async function uploadPatientCommunicationFile(
  _input: UploadPatientFileInput,
) {
  throw new Error(
    "uploadPatientCommunicationFile has moved to helper-job multipart upload. Use app/api/report-writing/upload-to-praktika/route.ts.",
  );
}

export async function uploadPatientImageFile(_input: UploadPatientFileInput) {
  throw new Error(
    "uploadPatientImageFile has moved to helper-job multipart upload. Add a multipart_storage helper job for image uploads.",
  );
}