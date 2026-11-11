import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { xeroFetch } from "@/lib/xero";
export type InvoiceRun = {
  id: string;
  provider_id: string;
  billing_period_id: string;
  tenant_id: string;
  contact_id: string;
  invoice_id: string | null;
  invoice_payload: Record<string, unknown>;
  supporting_data_hash: string;
  creation_attempted: boolean;
  lock_token: string | null;
  statement_attached: boolean;
  production_attached: boolean;
};
export type InvoiceIdentity = {
  InvoiceID?: string;
  Contact?: { ContactID?: string };
  Status?: string;
  Type?: string;
};
export function verifyInvoice(
  invoice: InvoiceIdentity,
  contactId: string,
  invoiceId?: string | null,
) {
  if (
    !invoice.InvoiceID ||
    invoice.Contact?.ContactID?.toLowerCase() !== contactId.toLowerCase() ||
    (invoiceId && invoice.InvoiceID !== invoiceId) ||
    invoice.Type !== "ACCREC" ||
    ["DELETED", "VOIDED", "PAID"].includes(invoice.Status || "")
  ) {
    throw new Error(
      "Xero invoice identity or status could not be verified. No attachments were sent.",
    );
  }
}
export function supportingDataHash(input: unknown): string {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value
        .map(normalise)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalise(item)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(normalise(input)))
    .digest("hex");
}
function financialLineHash(payload: Record<string, unknown>) {
  if (!Array.isArray(payload?.LineItems)) return null;
  return supportingDataHash(payload.LineItems.map((line: Record<string, unknown>) => ({
    UnitAmount: line.UnitAmount,
    Quantity: line.Quantity,
    AccountCode: line.AccountCode,
    TaxType: line.TaxType,
  })));
}
export async function acquireInvoiceRun(
  providerId: string,
  periodId: string,
  payload: Record<string, unknown>,
  supportingHash: string,
) {
  const tenant = process.env.XERO_TENANT_ID;
  if (!tenant)
    throw new Error("XERO_TENANT_ID is required for safe invoice matching.");
  const [provider, period] = await Promise.all([
    db
      .from("providers")
      .select("id,name,xero_contact_id,is_active")
      .eq("id", providerId)
      .single(),
    db
      .from("billing_periods")
      .select("id,label,month,year")
      .eq("id", periodId)
      .single(),
  ]);
  if (
    provider.error ||
    !provider.data?.is_active ||
    !provider.data.xero_contact_id ||
    period.error
  )
    throw new Error(
      "An active provider, mapped Xero contact and valid billing period are required.",
    );
  const contactId = provider.data.xero_contact_id;
  if (!/^[a-f0-9-]{36}$/i.test(contactId))
    throw new Error("Invalid Xero contact mapping.");
  const canonical = {
    ...payload,
    Contact: { ContactID: contactId },
    Reference: period.data.label,
  };
  const inserted = await db
    .from("billing_xero_invoice_runs")
    .insert({
      provider_id: providerId,
      billing_period_id: periodId,
      tenant_id: tenant,
      contact_id: contactId,
      invoice_payload: canonical,
      supporting_data_hash: supportingHash,
    });
  if (inserted.error && inserted.error.code !== "23505")
    throw new Error(
      "Invoice tracking unavailable. Install the receipt migration before sending invoices.",
    );
  const token = randomUUID();
  const claimed = await db
    .from("billing_xero_invoice_runs")
    .update({ lock_token: token, locked_at: new Date().toISOString() })
    .eq("provider_id", providerId)
    .eq("billing_period_id", periodId)
    .eq("tenant_id", tenant)
    .is("lock_token", null)
    .select("*")
    .maybeSingle();
  if (claimed.error || !claimed.data)
    throw new Error(
      "This provider's invoice is already processing. If interrupted, an administrator must reconcile the saved run before unlocking it.",
    );
  const run = claimed.data as InvoiceRun;
  if (
    run.contact_id !== contactId ||
    run.supporting_data_hash !== supportingHash ||
    financialLineHash(run.invoice_payload) !== financialLineHash(canonical)
  ) {
    await releaseInvoiceRun(run);
    throw new Error(
      "Provider billing details or Xero contact mapping have changed since the saved invoice run. Review the existing invoice before continuing; no replacement was created.",
    );
  }
  return run;
}
export async function releaseInvoiceRun(run: InvoiceRun) {
  const result = await db
    .from("billing_xero_invoice_runs")
    .update({ lock_token: null, locked_at: null })
    .eq("id", run.id)
    .eq("lock_token", run.lock_token);
  if (result.error)
    throw new Error(
      "Invoice processing finished, but its lock needs administrator review.",
    );
}
export async function ensureRunInvoice(
  run: InvoiceRun,
): Promise<{ invoice: InvoiceIdentity; created: boolean }> {
  if (run.invoice_id) {
    const response = await xeroFetch(
      `/Invoices/${encodeURIComponent(run.invoice_id)}`,
    );
    const invoice = response?.Invoices?.[0];
    if (!invoice)
      throw new Error(
        "Saved Xero invoice is unavailable. No replacement invoice was created.",
      );
    verifyInvoice(invoice, run.contact_id, run.invoice_id);
    return { invoice, created: false };
  }
  // An interrupted create is ambiguous. Never repeat it after Xero's short idempotency window.
  if (run.creation_attempted)
    throw new Error(
      "An earlier invoice creation needs administrator reconciliation. No additional invoice was created.",
    );
  const where = `Contact.ContactID==Guid("${run.contact_id}")&&Reference==${JSON.stringify(run.invoice_payload.Reference)}`;
  const existing = await xeroFetch(
    `/Invoices?where=${encodeURIComponent(where)}`,
  );
  if (!Array.isArray(existing?.Invoices))
    throw new Error("Existing invoice lookup could not be verified.");
  if (
    existing.Invoices.some(
      (i: InvoiceIdentity) => !["DELETED", "VOIDED"].includes(i.Status || ""),
    )
  )
    throw new Error(
      "An existing invoice matches this provider and period. An administrator must link it before retrying; no duplicate was created.",
    );
  const attempt = await db
    .from("billing_xero_invoice_runs")
    .update({ creation_attempted: true })
    .eq("id", run.id)
    .eq("lock_token", run.lock_token);
  if (attempt.error)
    throw new Error("Could not record invoice creation attempt.");
  run.creation_attempted = true;
  const response = await xeroFetch("/Invoices", {
    method: "POST",
    headers: { "Idempotency-Key": run.id },
    body: { Invoices: [run.invoice_payload] },
  });
  const invoice = response?.Invoices?.[0];
  if (!invoice || response.Invoices.length !== 1)
    throw new Error("Xero invoice creation outcome requires reconciliation.");
  verifyInvoice(invoice, run.contact_id);
  const saved = await db
    .from("billing_xero_invoice_runs")
    .update({ invoice_id: invoice.InvoiceID })
    .eq("id", run.id)
    .eq("lock_token", run.lock_token);
  if (saved.error)
    throw new Error(
      "Xero created an invoice, but its ID could not be saved. Administrator reconciliation is required before retrying.",
    );
  run.invoice_id = invoice.InvoiceID!;
  return { invoice, created: true };
}
export async function markRunAttachment(
  run: InvoiceRun,
  field: "statement_attached" | "production_attached",
) {
  const result = await db
    .from("billing_xero_invoice_runs")
    .update({ [field]: true })
    .eq("id", run.id)
    .eq("lock_token", run.lock_token);
  if (result.error)
    throw new Error(
      "Attachment confirmed by Xero, but tracking could not be saved. Retry to reconcile.",
    );
}
