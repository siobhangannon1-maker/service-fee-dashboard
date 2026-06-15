import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [praktikaResult, medirefResult] = await Promise.all([
    supabaseAdmin
      .from("praktika_helper_jobs")
      .select(
        "id, job_type, status, error_message, attempts, locked_at, locked_by, created_at, updated_at, completed_at, failed_at",
      )
      .order("created_at", { ascending: false })
      .limit(25),

    supabaseAdmin
      .from("mediref_helper_jobs")
      .select(
        "id, job_type, status, error, attempts, locked_at, locked_by, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (praktikaResult.error) {
    return NextResponse.json(
      { error: praktikaResult.error.message },
      { status: 500 },
    );
  }

  if (medirefResult.error) {
    return NextResponse.json(
      { error: medirefResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    jobs: [
      ...(praktikaResult.data || []).map((job) => ({
        ...job,
        system: "Praktika",
        error: job.error_message,
      })),
      ...(medirefResult.data || []).map((job) => ({
        ...job,
        system: "MediRef",
        completed_at: null,
        failed_at: job.status === "failed" ? job.updated_at : null,
      })),
    ].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  });
}