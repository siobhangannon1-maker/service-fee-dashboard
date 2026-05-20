import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  updatePraktikaSession,
} from "@/lib/praktika/hybrid-session-store";
import { encryptTemporaryCredential } from "@/lib/praktika/temporary-credentials-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: "Enter both your Praktika username and password.",
        },
        { status: 400 },
      );
    }

    const mode = await getCurrentUserPraktikaSessionMode();
    const now = new Date().toISOString();

    await updatePraktikaSession(mode, {
      pending_praktika_username: username,
      pending_praktika_password: encryptTemporaryCredential(password),
      credentials_updated_at: now,
      status: "refresh_requested",
      message:
        "Praktika login details received securely. Waiting for the local helper to sign in.",
      refresh_requested_at: now,
      mfa_code: null,
      mfa_code_updated_at: null,
    });

    return NextResponse.json({
      ok: true,
      scope: "user",
      message:
        "Praktika login details saved temporarily and encrypted. The local helper will now try to sign in.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error?.message ||
          "Could not save Praktika login details for this user.",
      },
      { status: 500 },
    );
  }
}