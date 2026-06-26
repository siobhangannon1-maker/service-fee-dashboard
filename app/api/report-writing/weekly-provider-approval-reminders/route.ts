import { NextResponse } from "next/server";
import { sendWeeklyProviderApprovalReminders } from "@/lib/report-writing/provider-approval-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const result = await sendWeeklyProviderApprovalReminders();

    return NextResponse.json(result);
  } catch (error) {
    console.error("Weekly provider approval reminder failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send weekly provider reminders.",
      },
      { status: 500 },
    );
  }
}