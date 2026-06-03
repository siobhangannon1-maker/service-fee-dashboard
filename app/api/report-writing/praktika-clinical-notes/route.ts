import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isoDateOnly(value: unknown) {
  return clean(value).slice(0, 10);
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
  id?: string;
  author?: string;
  date?: string;
  text?: string;
  deleted?: boolean;
  appointmentid?: string | null;
  dateCreated?: string;
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
    const key = clean(note.id) || JSON.stringify(note).slice(0, 200);

    if (!unique.has(key)) {
      unique.set(key, note);
    }
  }

  return Array.from(unique.values());
}

function noteMatchesDate(note: ClinicalNote, appointmentDate: string) {
  const targetDate = isoDateOnly(appointmentDate);

  if (!targetDate) return false;

  const noteDate = isoDateOnly(note.date);
  const createdDate = isoDateOnly(note.dateCreated);

  if (noteDate === targetDate || createdDate === targetDate) {
    return true;
  }

  const text = clean(note.text).toLowerCase();

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

  return clean(note.appointmentid) === appointmentId;
}

async function findCachedClinicalNotes(params: {
  patientId: string;
  appointmentDate?: string;
}) {
  const { data } = await supabase
    .from("report_drafts")
    .select("*")
    .eq("praktika_patient_id", params.patientId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data?.length) return null;

  const targetDate = isoDateOnly(params.appointmentDate);

  const matchingDraft = data.find((draft: any) => {
    const createdDate = isoDateOnly(draft.created_at);

    return (
      !targetDate ||
      createdDate === targetDate ||
      clean(draft.patient_dob) === targetDate
    );
  });

  if (!matchingDraft) return null;

  const savedText =
    clean(matchingDraft.clinical_notes) ||
    clean(matchingDraft.source_clinical_notes) ||
    clean(matchingDraft.source_text);

  if (!savedText) return null;

  return {
    success: true,
    notes: [],
    text: savedText,
    matchedCount: 1,
    totalNotes: 1,
    source: "cached_draft",
  };
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

    const practiceId =
      clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    if (!patientId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing patientId.",
        },
        { status: 400 },
      );
    }

    const cached = await findCachedClinicalNotes({
      patientId,
      appointmentDate,
    });

    if (cached) {
      return NextResponse.json(cached);
    }

    const parsed = await fetchClinicalNotesFromPraktika({
      patientId,
      practiceId,
      mode,
    });

    if (!parsed) {
      return NextResponse.json({
        success: true,
        notes: [],
        text: "",
        matchedCount: 0,
        totalNotes: 0,
        message: "Praktika returned an empty response.",
      });
    }

    const notes = extractClinicalNotes(parsed).filter(
      (note) => !note.deleted,
    );

    const matchingNotes = notes.filter((note) => {
      return (
        noteMatchesAppointment(note, appointmentId) ||
        noteMatchesDate(note, appointmentDate)
      );
    });

    const text = matchingNotes
      .map((note) => clean(note.text))
      .filter(Boolean)
      .join("\n\n---\n\n");

    return NextResponse.json({
      success: true,
      notes: matchingNotes,
      text,
      matchedCount: matchingNotes.length,
      totalNotes: notes.length,
      source: "praktika_live",
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