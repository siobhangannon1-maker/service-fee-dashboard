import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function hasValidCronSecret(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return false;
  }

  const authHeader = request.headers.get("authorization") || "";
  const querySecret = new URL(request.url).searchParams.get("secret") || "";

  return (
    authHeader === `Bearer ${configuredSecret}` ||
    querySecret === configuredSecret
  );
}

async function isAllowed(request: Request) {
  if (hasValidCronSecret(request)) {
    return true;
  }

  try {
    await requireRole(["super_admin"]);
    return true;
  } catch {
    return false;
  }
}

async function kickBackgroundProcessing(request: Request) {
  if (!(await isAllowed(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const secret = process.env.CRON_SECRET;

  const scan = url.searchParams.get("scan") || "25";
  const processCount = url.searchParams.get("process") || "2";

  const targetUrl = secret
    ? `${origin}/api/ai/brain/process-recent-imports?secret=${encodeURIComponent(
        secret
      )}&scan=${encodeURIComponent(scan)}&process=${encodeURIComponent(processCount)}`
    : `${origin}/api/ai/brain/process-recent-imports?scan=${encodeURIComponent(
        scan
      )}&process=${encodeURIComponent(processCount)}`;

  fetch(targetUrl, {
    method: "POST",
    cache: "no-store",
  }).catch((error) => {
    console.warn("Background processing trigger failed:", error);
  });

  return NextResponse.json({
    success: true,
    message: "Background processing requested.",
    target: "/api/ai/brain/process-recent-imports",
    scan: Number(scan),
    process: Number(processCount),
  });
}

export async function GET(request: Request) {
  return kickBackgroundProcessing(request);
}

export async function POST(request: Request) {
  return kickBackgroundProcessing(request);
}
