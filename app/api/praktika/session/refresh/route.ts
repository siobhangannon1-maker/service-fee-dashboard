import { NextResponse } from "next/server";
import { markPraktikaRefreshRequested } from "@/lib/praktika/session-store";

export const runtime = "nodejs";

export async function POST() {
  try {
    await markPraktikaRefreshRequested();

    return NextResponse.json({
      ok: true,
      message:
        "Praktika refresh requested. The local helper machine will complete the browser login.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not request Praktika refresh.",
      },
      { status: 500 },
    );
  }
}