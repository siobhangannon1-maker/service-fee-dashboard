import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const patients = await searchPraktikaPatients({
      firstName: String(body.firstName || "").trim(),
      lastName: String(body.lastName || "").trim(),
      dob: String(body.dob || "").trim(),
      mobile: String(body.mobile || "").trim(),
    });

    return NextResponse.json({
      success: true,
      patients,
    });
  } catch (error) {
    console.error("Praktika patient search error:", error);

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