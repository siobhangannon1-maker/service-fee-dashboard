import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isoDateOnly(value: unknown) {
  const text = clean(value);
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const auMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (auMatch) {
    const day = auMatch[1].padStart(2, "0");
    const month = auMatch[2].padStart(2, "0");
    const year = auMatch[3];
    return `${year}-${month}-${day}`;
  }

  return "";
}

function auDateFromIso(value: string) {
  const iso = isoDateOnly(value);
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

function auDateShortFromIso(value: string) {
  const iso = isoDateOnly(value);
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year.slice(-2)}`;
}

type ClinicalNote = {
  id?: string | number;
  oldid?: string | number | null;
  previd?: string | number | null;
  author?: string;
  date?: string;
  text?: string;
  notes?: string;
  note?: string;
  body?: string;
  content?: string;
  value?: string;
  deleted?: boolean;
  appointmentid?: string | number | null;
  appointmentId?: string | number | null;
  appointment_id?: string | number | null;
  iAppointmentId?: string | number | null;
  dateCreated?: string;
  createdDate?: string;
  created?: string;
  history?: ClinicalNote[];
  [key: string]: unknown;
};

function extractClinicalNotes(parsed: any): ClinicalNote[] {
  const found: ClinicalNote[] = [];

  function walk(value: any) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== "object") return;

    if (Array.isArray(value.patient_clinicalnotes)) {
      found.push(...value.patient_clinicalnotes);
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  }

  walk(parsed);

  const unique = new Map<string, ClinicalNote>();

  for (const note of found) {
    const key = clean(note.id) || JSON.stringify(note).slice(0, 300);
    if (!unique.has(key)) unique.set(key, note);
  }

  return Array.from(unique.values());
}

function getClinicalNoteText(note: ClinicalNote) {
  const direct =
    clean(note.text) ||
    clean(note.notes) ||
    clean(note.note) ||
    clean(note.body) ||
    clean(note.content) ||
    clean(note.value);

  if (direct) return direct;

  const possibleTextKeys = [
    "vchText",
    "vchNote",
    "vchNotes",
    "clinicalNote",
    "clinical_notes",
    "clinicalNotes",
    "noteText",
    "note_text",
    "description",
  ];

  for (const key of possibleTextKeys) {
    const value = clean(note[key]);
    if (value) return value;
  }

  return "";
}

function noteMatchesDate(note: ClinicalNote, appointmentDate: string) {
  const targetDate = isoDateOnly(appointmentDate);
  if (!targetDate) return false;

  const possibleDates = [note.date, note.dateCreated, note.createdDate, note.created]
    .map(isoDateOnly)
    .filter(Boolean);

  if (possibleDates.includes(targetDate)) return true;

  const text = getClinicalNoteText(note).toLowerCase();
  const auLong = auDateFromIso(targetDate).toLowerCase();
  const auShort = auDateShortFromIso(targetDate).toLowerCase();

  return Boolean(
    text.includes(`appointment of ${auLong}`) ||
      text.includes(`appointment of ${auShort}`) ||
      text.includes(auLong) ||
      text.includes(auShort),
  );
}

function noteMatchesAppointment(note: ClinicalNote, appointmentId: string) {
  if (!appointmentId) return false;

  return (
    clean(note.appointmentid) === appointmentId ||
    clean(note.appointmentId) === appointmentId ||
    clean(note.appointment_id) === appointmentId ||
    clean(note.iAppointmentId) === appointmentId
  );
}

function looksLikeAppointmentOnlyText(value: unknown) {
  const text = clean(value).toLowerCase();
  if (!text) return true;

  const hasAppointmentMarker =
    text.includes("appointment notes:") ||
    text.includes("treatment type:") ||
    text.includes("treatment label:") ||
    text.includes("has surgeon approved suitability") ||
    text.includes("949 code added") ||
    text.includes("fasting 6 hours prior");

  const hasClinicalMarker =
    /\b(la:|lignocaine|irrigated|closed|suture|ha,|poig|extraction completed|flap|socket|curett|debrid|implant|graft|probe|bpe|bleeding|calculus|plaque|periodontal|reviewed|consented|anaesthetic|sutured)\b/i.test(text);

  return hasAppointmentMarker && !hasClinicalMarker;
}

async function fetchClinicalNotesFromPraktika({
  patientId,
  practiceId,
  mode,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  return await praktikaHelperPost<any>({
    mode,
    jobType: "report_writing_clinical_notes",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 30,
    timeoutMs: 300_000,
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const patientId = clean(body.patientId);
    const appointmentDate = clean(body.appointmentDate);
    const appointmentId = clean(body.appointmentId);
    const practiceId = clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    if (!patientId) {
      return NextResponse.json(
        { success: false, error: "Missing patientId." },
        { status: 400 },
      );
    }

    const parsed = await fetchClinicalNotesFromPraktika({ patientId, practiceId, mode });
    const notes = extractClinicalNotes(parsed).filter((note) => !note.deleted);

    const matchingNotes = notes.filter((note) =>
      noteMatchesAppointment(note, appointmentId) ||
      noteMatchesDate(note, appointmentDate),
    );

    const text = matchingNotes
      .map((note) => getClinicalNoteText(note))
      .filter(Boolean)
      .filter((noteText) => !looksLikeAppointmentOnlyText(noteText))
      .join("\n\n---\n\n");

    return NextResponse.json({
      success: true,
      notes: matchingNotes,
      text,
      matchedCount: matchingNotes.length,
      totalNotes: notes.length,
      source: "praktika_live",
      debug: {
        patientId,
        appointmentDate,
        appointmentDateIso: isoDateOnly(appointmentDate),
        appointmentId,
        practiceId,
        firstNotePreview: notes[0]
          ? {
              id: notes[0].id,
              date: notes[0].date,
              dateIso: isoDateOnly(notes[0].date),
              appointmentid: notes[0].appointmentid,
              appointmentId: notes[0].appointmentId,
              appointment_id: notes[0].appointment_id,
              textPreview: getClinicalNoteText(notes[0]).slice(0, 250),
              keys: Object.keys(notes[0]).slice(0, 40),
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Fetch Praktika clinical notes failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Praktika clinical notes.",
      },
      { status: 500 },
    );
  }
}
