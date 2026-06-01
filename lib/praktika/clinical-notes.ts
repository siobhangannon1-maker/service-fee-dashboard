import { praktikaPost } from "@/lib/praktika/praktika-client";

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
  return await praktikaPost<GetClinicalNotesResponse>({
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
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
  const existing = await getPraktikaClinicalNotes({
    praktikaPatientId,
    practiceId,
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

  const response = await praktikaPost<any>({
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
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