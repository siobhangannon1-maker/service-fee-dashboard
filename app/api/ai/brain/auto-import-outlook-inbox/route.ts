import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const origin = new URL(req.url).origin;

    const response = await fetch(
      `${origin}/api/ai/brain/import-outlook-inbox`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify({
          limit: 10,
        }),
      }
    );

    const text = await response.text();

    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: "Import route did not return JSON.",
          status: response.status,
          raw: text.slice(0, 500),
        },
        { status: 500 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(result, { status: response.status });
    }

    return NextResponse.json({
      success: true,
      mode: "auto_import_outlook_inbox",
      result,
    });
  } catch (error: any) {
    console.error("Auto import Outlook inbox error:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to auto-import Outlook inbox.",
      },
      { status: 500 }
    );
  }
}