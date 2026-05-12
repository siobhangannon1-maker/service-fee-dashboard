import { requestPraktikaJson, PRAKTIKA_APP_BASE_URL } from "@/lib/praktika/praktika-request";

const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";

function getCookie() {
  const cookie = process.env.PRAKTIKA_COOKIE;

  if (!cookie) {
    throw new Error("Missing PRAKTIKA_COOKIE.");
  }

  return cookie;
}

function formatPraktikaDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

async function postMultipartToPraktika(formData: FormData) {
  const response = await fetch(
    `${PRAKTIKA_APP_BASE_URL}/php/forms/db_updateFormData.php`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        Cookie: getCookie(),
        Origin: PRAKTIKA_APP_BASE_URL,
        Referer: `${PRAKTIKA_APP_BASE_URL}/v2/patient-directory/patient-search`,
      },
      body: formData,
      cache: "no-store",
    }
  );

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Praktika upload did not return JSON: ${text.slice(0, 300)}`);
  }
}

export async function uploadPatientCommunicationFile({
  patientId,
  file,
  fileName,
  notes = "",
}: {
  patientId: string | number;
  file: File | Blob;
  fileName: string;
  notes?: string;
}) {
  const formData = new FormData();

  formData.append("practice_id", PRAKTIKA_PRACTICE_ID);
  formData.append("patient_id", String(patientId));
  formData.append("patient_communication[typeId]", "3");
  formData.append("patient_communication[file][direction]", "2");
  formData.append("patient_communication[file][name]", fileName);
  formData.append("patient_communication[file][notes]", notes);
  formData.append("patient_communication[file][file]", file, fileName);
  formData.append(
    "patient_communication[file][modifiedDate]",
    formatPraktikaDateTime()
  );

  return postMultipartToPraktika(formData);
}

export async function uploadPatientImageFile({
  patientId,
  file,
  fileName,
  notes = "",
  teeth = "",
}: {
  patientId: string | number;
  file: File | Blob;
  fileName: string;
  notes?: string;
  teeth?: string;
}) {
  const formData = new FormData();

  formData.append("practice_id", PRAKTIKA_PRACTICE_ID);
  formData.append("patient_id", String(patientId));
  formData.append("patient_images[file][id]", "0");
  formData.append("patient_images[file][teeth]", teeth);
  formData.append("patient_images[file][name]", fileName);
  formData.append("patient_images[file][notes]", notes);
  formData.append("patient_images[file][file]", file, fileName);
  formData.append("patient_images[file][modifiedDate]", formatPraktikaDateTime());

  return postMultipartToPraktika(formData);
}

export async function getPatientClinicalNotes(patientId: string | number) {
  return requestPraktikaJson({
    path: "/php/forms/db_getFormData.php",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${PRAKTIKA_APP_BASE_URL}/v2/patient-directory/patient-search`,
    },
    body: JSON.stringify([
      {
        parameters: [
          {
            practice_id: Number(PRAKTIKA_PRACTICE_ID),
            patient_id: String(patientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ]),
  });
}

export async function createPatientClinicalNote({
  patientId,
  text,
  author = "AI",
}: {
  patientId: string | number;
  text: string;
  author?: string;
}) {
  const now = new Date();
  const dateTime = `${formatPraktikaDateTime(now)}:00`;

  /**
   * IMPORTANT:
   * Praktika normally generated the note id before commit in your captured request.
   * For first test, we use a temporary negative id.
   * Test this ONLY on a dummy patient first.
   */
  const tempId = `-${Date.now()}`;

  const payload = [
    {
      request_id: `${process.env.PRAKTIKA_COOKIE?.split("=")[1]?.split(";")[0] ?? "request"}_ai`,
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
  ];

  return requestPraktikaJson({
    path: "/php/forms/db_commitFormData.php",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${PRAKTIKA_APP_BASE_URL}/v2/patient-directory/patient-search`,
    },
    body: JSON.stringify(payload),
  });
}