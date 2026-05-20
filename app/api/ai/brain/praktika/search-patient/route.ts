import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await request.json();

    const patients = await withPraktikaAutoRefresh(
      () =>
        searchPraktikaPatients({
          firstName: String(body.firstName || "").trim(),
          lastName: String(body.lastName || "").trim(),
          dob: String(body.dob || "").trim(),
          mobile: String(body.mobile || "").trim(),
        }),
      {
        mode,
      },
    );

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
