import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { runPraktikaDiscoveryProbe } from "@/lib/praktika/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const discovery = await runPraktikaDiscoveryProbe();

    return NextResponse.json({
      success: true,
      probes: discovery.probes || [],
      discoveredScriptUrls: discovery.discoveredScriptUrls || [],
      discoveredApiHints: discovery.discoveredApiHints || [],
      endpointHints: discovery.endpointHints || [],
    });
  } catch (error) {
    console.error("Praktika probe error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run Praktika probe.",
      },
      { status: 500 },
    );
  }
}