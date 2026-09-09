import { ApiAuthorizationError, requireApiUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireApiUser();
    const { data: role, error: roleError } = await supabase.from("user_roles")
      .select("role").eq("user_id", user.id).maybeSingle();
    const privileged = !roleError && ["admin", "super_admin"].includes(role?.role || "");
    const params = new URL(request.url).searchParams;
    const scope = params.get("scope") || (privileged ? "global" : "user");
    if (!["global", "user"].includes(scope)) {
      return NextResponse.json({ error: "Invalid scope." }, { status: 400 });
    }
    if (scope === "global" && !privileged) {
      throw new ApiAuthorizationError(403, "Access denied.");
    }
    for (const key of ["user_id", "app_user_id", "appUserId"]) {
      if (params.has(key) && params.get(key) !== user.id) {
        throw new ApiAuthorizationError(403, "Access denied.");
      }
    }
    // Null-owner practice jobs are visible only in privileged global mode.
    const jobs = <Columns extends string>(table: "praktika_helper_jobs" | "mediref_helper_jobs", columns: Columns) => {
      const query = supabaseAdmin.from(table).select(columns);
      return scope === "user" ? query.eq("app_user_id", user.id) : query;
    };
    const [praktikaResult, medirefResult] = await Promise.all([
      jobs("praktika_helper_jobs",
          "id, job_type, status, attempts, locked_at, locked_by, created_at, updated_at, completed_at, failed_at",
        )
        .order("created_at", { ascending: false })
        .limit(25),

      jobs("mediref_helper_jobs",
          "id, job_type, status, attempts, locked_at, locked_by, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (praktikaResult.error) {
      return NextResponse.json(
        { error: "Could not load helper jobs." },
        { status: 500 },
      );
    }

    if (medirefResult.error) {
      return NextResponse.json(
        { error: "Could not load helper jobs." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      scope,
      jobs: [
        ...(praktikaResult.data || []).map((job) => ({
          ...job,
          system: "Praktika",
          error: job.status === "failed" ? "Job failed." : null,
        })),
        ...(medirefResult.data || []).map((job) => ({
          ...job,
          system: "MediRef",
          error: job.status === "failed" ? "Job failed." : null,
          completed_at: null,
          failed_at: job.status === "failed" ? job.updated_at : null,
        })),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    });
  } catch (error) {
    if (error instanceof ApiAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load helper jobs." }, { status: 500 });
  }
}
