import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function valueFromUrl(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value && value.trim() ? value.trim() : undefined;
}

export async function GET(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const url = new URL(request.url);

    const firstName = valueFromUrl(url, "firstName");
    const lastName = valueFromUrl(url, "lastName");
    const dob = valueFromUrl(url, "dob");
    const mobile = valueFromUrl(url, "mobile");

    if (!firstName && !lastName && !dob && !mobile) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Add at least one query parameter: firstName, lastName, dob, mobile.",
          example:
            "/api/ai/debug/praktika-patient-search?firstName=Susan&lastName=Richardson&dob=1961-07-24&mobile=0400084995",
        },
        { status: 400 },
      );
    }

    const startedAt = Date.now();

    const matches = await searchPraktikaPatients({
      firstName,
      lastName,
      dob,
      mobile,
    });

    return NextResponse.json({
      success: true,
      elapsedMs: Date.now() - startedAt,
      input: {
        firstName,
        lastName,
        dob,
        mobile,
      },
      count: matches.length,
      topMatch: matches[0] || null,
      matches,
      interpretation:
        matches.length === 0
          ? "Praktika request completed but returned zero patient rows. If this patient exists, check practice ID, search filters, or Praktika auth/session behaviour."
          : "Praktika returned patient rows. If match status is still no_match in the pipeline, the issue is scoring or pipeline timing.",
    });
  } catch (error) {
    console.error("Praktika debug search failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Praktika debug search failed.",
        interpretation:
          "This is more consistent with a Praktika auth/login/request problem than a patient scoring problem.",
      },
      { status: 500 },
    );
  }
}
