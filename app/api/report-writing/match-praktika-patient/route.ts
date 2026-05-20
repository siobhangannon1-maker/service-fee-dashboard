import { NextResponse } from "next/server";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const patientName = String(body.patientName || "").trim();
    const patientDob = normaliseDob(String(body.patientDob || "").trim());

    if (!patientName) {
      return NextResponse.json(
        { success: false, error: "Missing patient name." },
        { status: 400 },
      );
    }

    const nameParts = patientName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts[nameParts.length - 1] || "";

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
        firstName: patient.firstName || patient.vchFirstName || "",
        lastName: patient.lastName || patient.vchLastName || "",
        dob: patient.dob || patient.dteBirthDate || "",
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
    console.error("Praktika patient match failed:", error);

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
