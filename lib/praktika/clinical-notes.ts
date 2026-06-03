import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

type GetClinicalNotesResponse = {
  patient_clinicalnotes: any[];
};

type AddClinicalNoteInput = {
  praktikaPatientId: string;
  noteText: string;
  practiceId?: number;
};

export async function getPraktikaClinicalNotes({
  praktikaPatientId,
  practiceId = 1181,
}: {
  praktikaPatientId: string;
  practiceId?: number;
}) {
  const mode = await getCurrentUserPraktikaSessionMode();

  return await praktikaHelperPost<GetClinicalNotesResponse>({
    mode,
    jobType: "get_clinical_notes",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 30,
    body: [
      {
        parameters: [
          {
            practice_id: practiceId,
            patient_id: String(praktikaPatientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });
}

export async function addPraktikaClinicalNote({
  praktikaPatientId,
  noteText,
  practiceId = 1181,
}: AddClinicalNoteInput) {
  const mode = await getCurrentUserPraktikaSessionMode();

  const existing = await praktikaHelperPost<GetClinicalNotesResponse>({
    mode,
    jobType: "get_clinical_notes_before_add",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 30,
    body: [
      {
        parameters: [
          {
            practice_id: practiceId,
            patient_id: String(praktikaPatientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });

  const currentNotes = existing.patient_clinicalnotes || [];

  const newNote = {
    id: -1,
    previd: null,
    rootid: null,
    type: 2,
    appointmentid: null,
    author: "",
    date: null,
    teeth: null,
    draft: false,
    text: noteText.endsWith("\n") ? noteText : `${noteText}\n`,
    editable: true,
    deleted: false,
    dateOverride: null,
    history: [],
  };

  const requestId = `${Date.now()}_clinical_note_${praktikaPatientId}`;

  const response = await praktikaHelperPost<any>({
    mode,
    jobType: "add_clinical_note",
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 20,
    body: [
      {
        request_id: requestId,
        practice_id: practiceId,
        patient_id: Number(praktikaPatientId),
        patient_clinicalnotes: [...currentNotes, newNote],
      },
    ],
  });

  const returnedNotes = response?.patient_clinicalnotes || [];
  const matchingNote = returnedNotes
    .slice()
    .reverse()
    .find((note: any) => note.text?.trim() === noteText.trim());

  return {
    response,
    praktikaNoteId: matchingNote?.id || null,
  };
}
