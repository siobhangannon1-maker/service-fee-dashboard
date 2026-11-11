import { NextResponse } from "next/server";
import { requireActiveApiUser, ApiAuthorizationError } from "@/lib/auth";
import {
  savePaymentEntry,
  PaymentEntryError,
} from "@/lib/billing/save-payment-entry";
export async function POST(request: Request) {
  try {
    const { user } = await requireActiveApiUser([
      "staff",
      "billing_staff",
      "practice_manager",
      "admin",
      "super_admin",
    ]);
    const body = await request.json();
    const entry = await savePaymentEntry(
      user.id,
      String(body.entryId || ""),
      body.entry || {},
      body.receiptIds,
    );
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ApiAuthorizationError ||
          error instanceof PaymentEntryError
            ? error.message
            : "Entry save failed. Please retry.",
      },
      {
        status:
          error instanceof ApiAuthorizationError ||
          error instanceof PaymentEntryError
            ? error.status
            : 500,
      },
    );
  }
}
