import { NextResponse } from "next/server";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseDob(dob: string) {
  if (!dob) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return dob;
  }

  return dob;
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json();

    const firstNameFromBody = cleanString(body.firstName);
    const lastNameFromBody = cleanString(body.lastName);
    const patientName = cleanString(body.patientName);
    const patientDob = normaliseDob(
      cleanString(body.patientDob || body.dob),
    );

    let firstName = firstNameFromBody;
    let lastName = lastNameFromBody;

    if ((!firstName || !lastName) && patientName) {
      const nameParts = patientName.split(/\s+/).filter(Boolean);
      firstName = nameParts[0] || "";
      lastName = nameParts[nameParts.length - 1] || "";
    }

    if (!firstName || !lastName) {
      return NextResponse.json(
        { success: false, error: "Missing patient first and last name." },
        { status: 400 },
      );
    }

    const results = await withPraktikaAutoRefresh(
      () =>
        searchPraktikaPatients({
          firstName,
          lastName,
          dob: patientDob,
        }),
      {
        mode,
      },
    );

    const candidates =
      results?.map((patient: any) => ({
        id: String(patient.id || patient.patientId || patient.iPatientId || ""),
        patientNumber:
          patient.patientNumber ||
          patient.vchPatientNo ||
          patient.vchPatientNumber ||
          patient.patient_no ||
          null,
        firstName: patient.firstName || patient.vchFirstName || "",
        lastName: patient.lastName || patient.vchLastName || "",
        dob: patient.dob || patient.dteBirthDate || "",
        mobile:
          patient.mobile ||
          patient.vchMobile ||
          patient.phone ||
          patient.vchPhone ||
          null,
        matchScore: patient.matchScore || patient.score || null,
        matchReason:
          patient.matchReason ||
          patient.reason ||
          "Candidate returned from Praktika search.",
      })) || [];

    return NextResponse.json({
      success: true,
      candidates,
    });
  } catch (error) {
    console.error("Clinical scribe Praktika patient match failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to search Praktika patients.",
      },
      { status: 500 },
    );
  }
}