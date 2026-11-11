import { NextResponse } from "next/server";
import { requireActiveApiUser, ApiAuthorizationError } from "@/lib/auth";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { RECEIPT_BUCKET } from "@/lib/billing/receipt-contract";
type Context = { params: Promise<{ id: string }> };
const roles = [
  "staff",
  "billing_staff",
  "practice_manager",
  "admin",
  "super_admin",
] as const;
export async function GET(request: Request, context: Context) {
  try {
    await requireActiveApiUser([...roles]);
    const { id } = await context.params;
    const row = await db
      .from("incorrect_payment_receipts")
      .select("storage_path,original_filename,status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (row.error || !row.data || row.data.status === "deleting")
      return NextResponse.json(
        { error: "Receipt unavailable." },
        { status: 404 },
      );
    const result = await db.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(
        row.data.storage_path,
        60,
        new URL(request.url).searchParams.has("download")
          ? { download: row.data.original_filename }
          : {},
      );
    if (result.error) throw result.error;
    return NextResponse.redirect(result.data.signedUrl, {
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const { user } = await requireActiveApiUser([...roles]);
    const { id } = await context.params;
    const row = await db
      .from("incorrect_payment_receipts")
      .select("billing_period_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (row.error)
      return NextResponse.json(
        { error: "Receipt unavailable." },
        { status: 404 },
      );
    const period = await db
      .from("billing_periods")
      .select("status")
      .eq("id", row.data.billing_period_id)
      .single();
    if (period.error || period.data.status !== "open")
      return NextResponse.json(
        { error: "This billing period is locked." },
        { status: 409 },
      );
    // Atomic claim: attachment processing uses the same conditional transition.
    const claim = await db
      .from("incorrect_payment_receipts")
      .update({ status: "deleting" })
      .eq("id", id)
      .is("xero_invoice_id", null)
      .in("status", ["pending", "failed", "deleting"])
      .is("deleted_at", null)
      .select("storage_path")
      .maybeSingle();
    if (claim.error)
      return NextResponse.json(
        {
          error: /receipt|review|invoice/i.test(claim.error.message)
            ? claim.error.message
            : "This receipt cannot be deleted safely.",
        },
        { status: 409 },
      );
    if (!claim.data)
      return NextResponse.json(
        {
          error:
            "Attached receipts or receipts being attached cannot be deleted.",
        },
        { status: 409 },
      );
    const removed = await db.storage
      .from(RECEIPT_BUCKET)
      .remove([claim.data.storage_path]);
    if (removed.error) throw removed.error;
    const saved = await db
      .from("incorrect_payment_receipts")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq("id", id)
      .eq("status", "deleting");
    if (saved.error) throw saved.error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof ApiAuthorizationError
          ? error.message
          : "Receipt operation failed. Please retry.",
    },
    { status: error instanceof ApiAuthorizationError ? error.status : 500 },
  );
}
