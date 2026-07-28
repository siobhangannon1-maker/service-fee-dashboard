import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_STALE_MS = 30_000;

function heartbeatIsFresh(lastHeartbeatAt: string | null) {
  if (!lastHeartbeatAt) return false;

  const heartbeatTime = new Date(lastHeartbeatAt).getTime();

  if (!Number.isFinite(heartbeatTime)) return false;

  return Date.now() - heartbeatTime <= HEARTBEAT_STALE_MS;
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("automation_workers")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          workers: [],
          error: error.message,
        },
        { status: 500 },
      );
    }

    const workers = (data || []).map((worker) => {
      const heartbeatFresh = heartbeatIsFresh(worker.last_heartbeat_at);

      let effectiveStatus = worker.status;

      if (!heartbeatFresh) {
        effectiveStatus = "offline";
      } else if (worker.is_paused) {
        effectiveStatus = "paused";
      }

      return {
        ...worker,

        // Preserve the value actually stored in Supabase.
        stored_status: worker.status,

        // The existing Automation page reads worker.status,
        // so replace it with the heartbeat-aware status.
        status: effectiveStatus,

        heartbeat_is_fresh: heartbeatFresh,
      };
    });

    return NextResponse.json(
      { workers },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load automation workers.";

    console.error("Automation workers API error:", error);

    return NextResponse.json(
      {
        workers: [],
        error: message,
      },
      { status: 500 },
    );
  }
}