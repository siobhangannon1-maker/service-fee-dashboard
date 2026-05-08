import { NextResponse } from "next/server";

import { routeClinicianForInboxItem } from "@/lib/ai/brain/clinicianRouting";
import { classifyOperationalWorkflow } from "@/lib/ai/brain/operationalWorkflow";
import { routeSpecialistForInboxItem } from "@/lib/ai/brain/specialistRouting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const persist = typeof body.persist === "boolean" ? body.persist : true;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const workflow = await classifyOperationalWorkflow({
      inboxItemId,
      persist,
    });

    const clinician = await routeClinicianForInboxItem({
      inboxItemId,
      persist,
    });

    const routing = await routeSpecialistForInboxItem({
      inboxItemId,
      persist,
    });

    return NextResponse.json({
      success: true,
      workflow,
      clinician,
      routing,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to test clinician routing.",
      },
      { status: 500 }
    );
  }
}
