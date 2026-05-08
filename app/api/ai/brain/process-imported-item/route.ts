import { NextResponse } from "next/server";

import { processImportedInboxItem } from "@/lib/ai/brain/processImportedInboxItem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function assertCronSecret(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";
  const querySecret = new URL(request.url).searchParams.get("secret") || "";

  return (
    authHeader === `Bearer ${configuredSecret}` ||
    querySecret === configuredSecret
  );
}

async function handle(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  let body: any = {};

  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const inboxItemId =
    body.inboxItemId ||
    url.searchParams.get("inboxItemId") ||
    url.searchParams.get("id");

  if (!inboxItemId) {
    return NextResponse.json(
      {
        error: "Missing inboxItemId.",
      },
      { status: 400 }
    );
  }

  const forceTrello =
    body.forceTrello === true || url.searchParams.get("forceTrello") === "true";

  const result = await processImportedInboxItem({
    inboxItemId,
    source: "manual_event_chain_trigger",
    forceTrello,
  });

  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
