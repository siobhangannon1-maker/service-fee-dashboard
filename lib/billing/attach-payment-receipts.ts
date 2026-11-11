import { loadInvoiceReceipts } from "./receipt-destinations";
import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { xeroFetch, xeroUploadInvoiceAttachment } from "@/lib/xero";
import {
  RECEIPT_BUCKET,
  receiptAttachmentName,
  type Receipt,
} from "./receipt-contract";
import type { InvoiceRun } from "./xero-invoice-runs";

type Attachment = {
  AttachmentID?: string;
  FileName?: string;
  ContentLength?: number;
};
export async function attachPaymentReceipts(
  run: InvoiceRun,
  snapshotIds?: string[],
) {
  const results: { receiptId: string; attached: boolean; error?: string }[] =
    [];
  if (snapshotIds && snapshotIds.length === 0) return results;
  const rows = (await loadInvoiceReceipts(run)).filter(
    (r) =>
      r.status !== "attached" && (!snapshotIds || snapshotIds.includes(r.id)),
  );
  for (const receipt of rows) {
    const name = receiptAttachmentName(receipt);
    // This conditional update races safely with the delete claim.
    const claim = await db
      .from("incorrect_payment_receipt_destinations")
      .update({
        status: "attaching",
        invoice_run_id: run.id,
        xero_invoice_id: run.invoice_id,
        attachment_filename: name,
        last_error: null,
      })
      .eq("receipt_id", receipt.id)
      .eq("provider_id", run.provider_id)
      .in("status", ["pending", "failed", "attaching"])
      .select("receipt_id")
      .maybeSingle();
    if (claim.error) throw new Error("Could not claim receipt for attachment.");
    if (!claim.data) continue;
    let confirmed = false;
    try {
      const list = await xeroFetch(`/Invoices/${run.invoice_id}/Attachments`);
      if (!Array.isArray(list?.Attachments))
        throw new Error("Could not verify invoice attachments. Please retry.");
      let attachment: Attachment | undefined = list.Attachments.find(
        (a: Attachment) => a.FileName === name,
      );
      if (!attachment) {
        if (list.Attachments.length >= 10)
          throw new Error(
            "Xero's 10-attachment limit has been reached. The invoice and original receipt are preserved.",
          );
        const file = await db.storage
          .from(RECEIPT_BUCKET)
          .download(receipt.storage_path);
        if (file.error || !file.data)
          throw new Error(
            "Original receipt file could not be read. Please retry.",
          );
        const bytes = Buffer.from(await file.data.arrayBuffer());
        if (
          bytes.length !== receipt.file_size ||
          createHash("sha256").update(bytes).digest("hex") !== receipt.sha256
        )
          throw new Error(
            "Receipt file integrity check failed. Administrator review is required.",
          );
        const uploaded = await xeroUploadInvoiceAttachment(
          run.invoice_id!,
          name,
          bytes,
          receipt.mime_type,
        );
        attachment = uploaded?.Attachments?.find(
          (a: Attachment) => a.FileName === name,
        );
      }
      if (
        !attachment?.AttachmentID ||
        Number(attachment.ContentLength) !== receipt.file_size
      )
        throw new Error(
          "Xero attachment confirmation is incomplete. Retry to reconcile before uploading again.",
        );
      confirmed = true;
      const saved = await db
        .from("incorrect_payment_receipt_destinations")
        .update({
          status: "attached",
          xero_attachment_id: attachment.AttachmentID,
          attached_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("receipt_id", receipt.id)
        .eq("status", "attaching");
      if (saved.error)
        throw new Error(
          "Xero confirmed the attachment but local tracking failed. Retry to reconcile.",
        );
      results.push({ receiptId: receipt.id, attached: true });
    } catch (error) {
      const message =
        error instanceof Error &&
        !error.message.startsWith("Xero request") &&
        !error.message.startsWith("Xero attachment upload")
          ? error.message
          : "Xero attachment failed or its outcome is uncertain. Retry to reconcile.";
      // Uncertain or confirmed remote outcomes stay protected from deletion until reconciled.
      // Keep every invoice-assigned failure protected until reconciliation.
      await db
        .from("incorrect_payment_receipt_destinations")
        .update({ status: "failed", last_error: message })
        .eq("receipt_id", receipt.id)
        .eq("status", "attaching");
      results.push({
        receiptId: receipt.id,
        attached: false,
        error: confirmed
          ? "Attached in Xero; tracking requires reconciliation."
          : message,
      });
    }
  }
  return results;
}
