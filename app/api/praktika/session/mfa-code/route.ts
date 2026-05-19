import { NextResponse } from "next/server";
import { savePraktikaMfaCode } from "@/lib/praktika/session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = String(body?.code || "").replace(/\D/g, "").trim();

    if (!code) {
      return NextResponse.json(
        {
          ok: false,
          message: "Missing MFA code.",
        },
        { status: 400 },
      );
    }

    await savePraktikaMfaCode(code);

    return NextResponse.json({
      ok: true,
      message: "MFA code saved. Waiting for local helper machine.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not save MFA code.",
      },
      { status: 500 },
    );
  }
}