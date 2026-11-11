import {
  readReceiptForm,
  ReceiptUploadError,
} from "@/lib/billing/receipt-upload";
import { NextResponse } from "next/server";
import { requireActiveApiUser, ApiAuthorizationError } from "@/lib/auth";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { createHash, randomUUID } from "node:crypto";
import {
  RECEIPT_BUCKET,
  MAX_RECEIPT_BYTES,
  receiptFileType,
} from "@/lib/billing/receipt-contract";

const roles = [
  "staff",
  "billing_staff",
  "practice_manager",
  "admin",
  "super_admin",
] as const;
export async function GET(request: Request) {
  try {
    await requireActiveApiUser([...roles]);
    const period = new URL(request.url).searchParams.get("period");
    if (!period)
      return NextResponse.json(
        { error: "Select a billing period." },
        { status: 400 },
      );
    const entry = new URL(request.url).searchParams.get("entry");
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(period) || (entry && !uuid.test(entry)))
      return NextResponse.json(
        { error: "Invalid receipt scope." },
        { status: 400 },
      );
    let query = db
      .from("incorrect_payment_receipts")
      .select(
        "*, destinations:incorrect_payment_receipt_destinations(*, provider:providers(name)), linked_entry:patient_financial_entries!incorrect_payment_receipts_patient_financial_entry_id_fkey(id,receipt_required,deleted_at,category)",
      );
    query = entry
      ? query.or(
          `billing_period_id.eq.${period},patient_financial_entry_id.eq.${entry}`,
        )
      : query.eq("billing_period_id", period);
    const { data, error } = await query
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const receipts = (data || []).map((row) => {
      const exported =
        !!row.xero_invoice_id ||
        row.destinations?.some(
          (d: { xero_invoice_id: string | null; status: string }) =>
            d.xero_invoice_id ||
            d.status === "attaching" ||
            d.status === "attached",
        );
      const lastRequired =
        row.linked_entry?.receipt_required &&
        !row.linked_entry.deleted_at &&
        row.linked_entry.category === "paid_to_wrong_provider" &&
        (data || []).filter(
          (other) =>
            other.patient_financial_entry_id ===
              row.patient_financial_entry_id && other.status !== "deleting",
        ).length <= 1;
      return {
        ...row,
        can_delete: !exported && !lastRequired && row.status !== "attaching",
      };
    });
    return NextResponse.json(
      { receipts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ApiAuthorizationError
            ? error.message
            : "Receipts could not be loaded. Check that the receipt migration is installed.",
      },
      { status: error instanceof ApiAuthorizationError ? error.status : 500 },
    );
  }
}
export async function POST(request: Request) {
  let path: string | undefined;
  try {
    const { user } = await requireActiveApiUser([...roles]);
    const form = await readReceiptForm(request);
    const file = form.get("file");
    const providerId = String(form.get("provider_id") || "");
    const periodId = String(form.get("billing_period_id") || "");
    const intendedProviderId =
      String(form.get("intended_provider_id") || "").trim() || null;
    const location = String(form.get("location") || "").trim() || null;
    const patientName = String(form.get("patient_name") || "").trim();
    const paymentDate = String(form.get("payment_date") || "");
    const amount = String(form.get("amount") || "");
    const notes = String(form.get("notes") || "").trim();
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > MAX_RECEIPT_BYTES ||
      (location !== null && !["paddington", "coorparoo"].includes(location)) ||
      patientName.length > 200 ||
      notes.length > 2000 ||
      (amount && !/^\d{1,10}(\.\d{1,2})?$/.test(amount)) ||
      (paymentDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
          Number.isNaN(Date.parse(paymentDate)) ||
          new Date(paymentDate).toISOString().slice(0, 10) !== paymentDate))
    ) {
      return NextResponse.json(
        {
          error:
            "Check the file (maximum 3 MB) and selected provider and billing period.",
        },
        { status: 400 },
      );
    }
    const [provider, period, intended] = await Promise.all([
      db
        .from("providers")
        .select("id")
        .eq("id", providerId)
        .eq("is_active", true)
        .single(),
      db
        .from("billing_periods")
        .select("id,status")
        .eq("id", periodId)
        .single(),
      intendedProviderId
        ? db
            .from("providers")
            .select("id")
            .eq("id", intendedProviderId)
            .eq("is_active", true)
            .single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (
      provider.error ||
      period.error ||
      period.data?.status !== "open" ||
      (intendedProviderId &&
        (intended.error || !intended.data || intendedProviderId === providerId))
    )
      return NextResponse.json(
        { error: "Select an active provider and an open billing period." },
        { status: 400 },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    let mime: string;
    try {
      mime = receiptFileType(file.name, bytes);
    } catch {
      return NextResponse.json(
        { error: "Upload a valid PNG, JPG, JPEG or PDF file." },
        { status: 400 },
      );
    }
    const id = randomUUID();
    path = `${periodId}/${providerId}/${location ? `${location}/` : ""}${id}`;
    const upload = await db.storage
      .from(RECEIPT_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upload.error) throw upload.error;
    const saved = await db.from("incorrect_payment_receipts").insert({
      id,
      provider_id: providerId,
      intended_provider_id: intendedProviderId,
      billing_period_id: periodId,
      location,
      original_filename: file.name.slice(0, 240),
      storage_path: path,
      mime_type: mime,
      file_size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      patient_name: patientName || null,
      payment_date: paymentDate || null,
      amount: amount ? Number(amount) : null,
      notes: notes || null,
      created_by: user.id,
    });
    if (saved.error) throw saved.error;
    return NextResponse.json({ success: true, receiptId: id });
  } catch (error) {
    if (path) await db.storage.from(RECEIPT_BUCKET).remove([path]);
    return NextResponse.json(
      {
        error:
          error instanceof ApiAuthorizationError ||
          error instanceof ReceiptUploadError
            ? error.message
            : "Receipt upload failed. Please retry.",
      },
      {
        status:
          error instanceof ApiAuthorizationError ||
          error instanceof ReceiptUploadError
            ? error.status
            : 500,
      },
    );
  }
}
