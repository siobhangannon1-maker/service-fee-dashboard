import { NextResponse } from "next/server";
import { sensitiveApiAccess } from "@/lib/auth";

// Compatibility tombstone: no delivery, preparation, or workflow side effects.
export async function POST() {
  const accessDenied = await sensitiveApiAccess("/api/report-writing/email-secure-pdf");
  if (accessDenied) return accessDenied;
  return NextResponse.json(
    { success: false, error: "Report Writing email delivery has been retired. Use MediRef." },
    { status: 410 },
  );
}
