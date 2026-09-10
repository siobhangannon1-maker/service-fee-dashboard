import { authorizeMedirefSession } from "@/lib/mediref/session-authorization";
import { NextResponse } from "next/server";
import {
  getMedirefSession,
  updateMedirefSession,
} from "@/lib/mediref/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authorization = await authorizeMedirefSession();
    if (authorization.response) return authorization.response;
    const body = await request.json();
    const email = String(body.email || body.username || "").trim();
    const password = String(body.password || "").trim();
    const scope = body?.scope || "user";

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required." },
        { status: 400 },
      );
    }

    if (scope !== "practice" && scope !== "user") return NextResponse.json({ ok: false, error: "Invalid session scope." }, { status: 400 });

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : { scope: "user" as const, appUserId: authorization.actorUserId };

    await getMedirefSession(mode);

    const now = new Date().toISOString();

    await updateMedirefSession(mode, {
      pending_mediref_email: email,
      pending_mediref_password: password,
      mediref_email: email,
      credentials_updated_at: now,
      status: "refresh_requested",
      message:
        "MediRef credentials were submitted. Local helper will continue login.",
      refresh_requested_at: now,
    });

    return NextResponse.json({
      success: true,
      message: "MediRef credentials submitted.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Could not submit MediRef credentials.",
      },
      { status: 500 },
    );
  }
}
