import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { runPraktikaEndpointTests } from "@/lib/praktika/testEndpoints";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const results = await runPraktikaEndpointTests();

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Endpoint test failed.",
      },
      { status: 500 },
    );
  }
}