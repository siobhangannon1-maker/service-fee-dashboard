import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normaliseText(value: string | null | undefined) {
  return (value || "").toLowerCase().trim();
}

function normaliseDob(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replaceAll("-", "/")
    .replaceAll(".", "/");
}

function scorePatientMatch({
  extractedName,
  extractedDob,
  patient,
}: {
  extractedName: string;
  extractedDob: string;
  patient: any;
}) {
  let score = 0;
  const matchedFields: string[] = [];
  const reasons: string[] = [];

  const patientName = normaliseText(patient.full_name);
  const patientDob = normaliseDob(patient.date_of_birth);

  const name = normaliseText(extractedName);
  const dob = normaliseDob(extractedDob);

  if (name && patientName) {
    if (name === patientName) {
      score += 60;
      matchedFields.push("full_name");
      reasons.push("Exact patient name match.");
    } else if (patientName.includes(name) || name.includes(patientName)) {
      score += 40;
      matchedFields.push("partial_name");
      reasons.push("Partial patient name match.");
    } else {
      const nameParts = name.split(" ").filter(Boolean);
      const matchedParts = nameParts.filter((part) =>
        patientName.includes(part)
      );

      if (matchedParts.length > 0) {
        score += Math.min(30, matchedParts.length * 15);
        matchedFields.push("name_parts");
        reasons.push("Some name parts matched.");
      }
    }
  }

  if (dob && patientDob) {
    if (dob === patientDob) {
      score += 40;
      matchedFields.push("date_of_birth");
      reasons.push("Date of birth matched.");
    }
  }

  return {
    confidence: Math.min(score / 100, 1),
    matchedFields,
    matchReason:
      reasons.length > 0 ? reasons.join(" ") : "No strong match found.",
  };
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await req.json();
    const { inboxItemId } = body;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const { data: inboxItem, error: inboxError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (inboxError || !inboxItem) {
      return NextResponse.json(
        { error: inboxError?.message || "Inbox item not found." },
        { status: 404 }
      );
    }

    const { data: aiCase } = await supabaseAdmin
      .from("ai_cases")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .maybeSingle();

    const extractedName =
      aiCase?.patient_name || inboxItem.patient_name || "";

    const extractedDob =
      aiCase?.patient_dob || inboxItem.patient_dob || "";

    if (!extractedName && !extractedDob) {
      return NextResponse.json(
        {
          error:
            "No patient name or DOB found. Run AI Brain analysis or classification first.",
        },
        { status: 400 }
      );
    }

    const { data: patients, error: patientsError } = await supabaseAdmin
      .from("patients")
      .select("*")
      .limit(500);

    if (patientsError) {
      return NextResponse.json(
        { error: patientsError.message },
        { status: 500 }
      );
    }

    const scoredMatches =
      patients
        ?.map((patient) => {
          const result = scorePatientMatch({
            extractedName,
            extractedDob,
            patient,
          });

          return {
            patient,
            ...result,
          };
        })
        .filter((match) => match.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5) || [];

    await supabaseAdmin
      .from("ai_patient_match_candidates")
      .delete()
      .eq("inbox_item_id", inboxItemId);

    if (scoredMatches.length > 0) {
      const rows = scoredMatches.map((match) => ({
        inbox_item_id: inboxItemId,
        patient_id: match.patient.id,
        confidence: match.confidence,
        match_reason: match.matchReason,
        matched_fields: match.matchedFields,
        status: "suggested",
      }));

      const { error: insertError } = await supabaseAdmin
        .from("ai_patient_match_candidates")
        .insert(rows);

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    if (aiCase?.id) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: aiCase.id,
        event_type: "patient_match_run",
        event_summary: "AI patient matching was run.",
        metadata: {
          extracted_name: extractedName,
          extracted_dob: extractedDob,
          matches_found: scoredMatches.length,
          top_confidence: scoredMatches[0]?.confidence || 0,
        },
      });
    }

    return NextResponse.json({
      success: true,
      extractedName,
      extractedDob,
      matches: scoredMatches.map((match) => ({
        patient_id: match.patient.id,
        full_name: match.patient.full_name,
        date_of_birth: match.patient.date_of_birth,
        confidence: match.confidence,
        matched_fields: match.matchedFields,
        match_reason: match.matchReason,
      })),
    });
  } catch (error: any) {
    console.error("Patient match error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to run patient matching." },
      { status: 500 }
    );
  }
}