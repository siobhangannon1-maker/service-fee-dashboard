import { loadInvoiceReceipts } from "@/lib/billing/receipt-destinations";
import { ZIP_MONEY_HUMM_FEES_LABEL } from "@/lib/billing/merchant-fee-labels";
import { calculateStatementCharges } from "@/lib/service-fees/statement-charge-totals";
import { beginBillingExport, finishBillingExport, BillingRolloutError } from "@/lib/billing/rollout-maintenance";
import { preflightReceiptAttachments } from "@/lib/billing/receipt-attachment-preflight";
import { AttachmentCapacityError } from "@/lib/billing/attachment-capacity";
import { sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createServiceFeeStatementPdf } from "@/lib/pdf/createServiceFeeStatementPdf";
import { createPraktikaProductionReportPdf } from "@/lib/pdf/createPraktikaProductionReportPdf";
import { fetchCompletedProceduresReport } from "@/lib/praktika/fetchCompletedProceduresReport";
import {
  filterProductionRowsForProvider,
  getPraktikaCompletedProcedureMappings,
} from "@/lib/praktika/filterProductionRowsForProvider";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  acquireInvoiceRun,
  supportingDataHash,
  ensureRunInvoice,
  releaseInvoiceRun,
  markRunAttachment,
  type InvoiceRun,
  type InvoiceIdentity,
} from "@/lib/billing/xero-invoice-runs";
import { attachPaymentReceipts } from "@/lib/billing/attach-payment-receipts";
import { xeroUploadInvoiceAttachment } from "@/lib/xero";

export const maxDuration = 300;

function money(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cleanLineItems(lines: any[]) {
  return lines.filter((line) => Number(line.UnitAmount || 0) !== 0);
}

function safeFileName(value: string) {
  return String(value || "file")
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getInvoiceId(invoice: any) {
  return (
    invoice?.InvoiceID ||
    invoice?.invoiceID ||
    invoice?.InvoiceId ||
    invoice?.id ||
    null
  );
}

export async function POST(request: Request) {
  const accessDenied = await sensitiveApiAccess(
    "/api/xero/create-service-fee-invoices",
    ["admin", "super_admin"],
  );
  if (accessDenied) return accessDenied;

  const lockedRuns: InvoiceRun[] = [];
  let exportRequestId: string | undefined;
  try {
    const body = await request.json();
    const providers = Array.isArray(body.providers)
      ? body.providers.map((provider: Parameters<typeof calculateStatementCharges>[0]) => ({
          ...provider,
          ...calculateStatementCharges(provider),
        }))
      : [];

    if (providers.length === 0) {
      return NextResponse.json(
        { success: false, error: "No providers supplied." },
        { status: 400 },
      );
    }

    if (
      !body.billingPeriodId ||
      new Set(providers.map((p: { providerId: string }) => p.providerId))
        .size !== providers.length
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "A billing period and unique provider IDs are required.",
        },
        { status: 400 },
      );
    }
    const periodResult = await supabaseAdmin
      .from("billing_periods")
      .select("id,label,month,year")
      .eq("id", body.billingPeriodId)
      .single();
    if (periodResult.error || !periodResult.data)
      return NextResponse.json(
        { success: false, error: "Invalid billing period." },
        { status: 400 },
      );
    const period = periodResult.data;
    exportRequestId = await beginBillingExport(period.id);
    body.reference = period.label;
    body.fromDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
    body.toDate = `${period.year}-${String(period.month).padStart(2, "0")}-${new Date(period.year, period.month, 0).getDate()}`;

    const invoicesPayload = providers.map((provider: any) => {
      const contact = provider.xeroContactId
        ? { ContactID: provider.xeroContactId }
        : { Name: provider.providerName };

      return {
        Type: "ACCREC",
        Contact: contact,
        Date: body.invoiceDate,
        DueDate: body.dueDate,
        Reference: body.reference,
        Status: "DRAFT",
        LineAmountTypes: "Exclusive",
        LineItems: cleanLineItems([
          {
            Description: "Service & Facility Fees - Brisbane",
            Quantity: 1,
            UnitAmount: money(provider.serviceFeeExGst),
            AccountCode: "220",
            TaxType: "OUTPUT",
          },
          {
            Description: "Lab/materials expenses",
            Quantity: 1,
            UnitAmount: money(provider.labMaterialsExGst),
            AccountCode: "225",
            TaxType: "OUTPUT",
          },
          {
            Description: ZIP_MONEY_HUMM_FEES_LABEL,
            Quantity: 1,
            UnitAmount: money(provider.hummFeesExGst),
            AccountCode: "227",
            TaxType: "OUTPUT",
          },
          {
            Description: `Patient fees owed to ${provider.providerName}`,
            Quantity: 1,
            UnitAmount: money(-provider.patientFeesPaidToFocusNoGst),
            AccountCode: "810",
            TaxType: "NONE",
          },
          {
            Description: "Less patient fees paid to another provider in error",
            Quantity: 1,
            UnitAmount: money(-provider.patientFeesPaidToAnotherProviderNoGst),
            AccountCode: "810",
            TaxType: "NONE",
          },
          {
            Description: `Plus patient fees received by ${provider.providerName} in error`,
            Quantity: 1,
            UnitAmount: money(provider.patientFeesReceivedInErrorNoGst),
            AccountCode: "810",
            TaxType: "NONE",
          },
          {
            Description: "Plus IV Facility Fees",
            Quantity: 1,
            UnitAmount: money(provider.ivFacilityFeesNoGst),
            AccountCode: "810",
            TaxType: "NONE",
          },
        ]),
      };
    });

    // Each provider is independent: preserve successful invoices when another is blocked or fails.
    const createdInvoices: (InvoiceIdentity | null)[] = Array(
      providers.length,
    ).fill(null);
    const indexedRuns: (InvoiceRun | undefined)[] = [];
    const receiptSnapshots: Awaited<
      ReturnType<typeof preflightReceiptAttachments>
    >[] = [];
    const providerErrors = new Map<number, string>();
    const capacityErrors = new Set<number>();
    let createdCount = 0;
    const standardNames = providers.map(
      (provider: { providerName: string }) => [
        safeFileName(
          `${provider.providerName} - ${body.reference} - Service Fee Statement.pdf`,
        ),
        safeFileName(
          `${provider.providerName} - ${body.reference} - Praktika Production Report.pdf`,
        ),
      ],
    );
    for (let index = 0; index < providers.length; index += 1) {
      try {
        const run = await acquireInvoiceRun(
          providers[index].providerId,
          body.billingPeriodId,
          invoicesPayload[index],
          supportingDataHash(providers[index]),
        );
        indexedRuns[index] = run;
        lockedRuns.push(run);
        receiptSnapshots[index] = await preflightReceiptAttachments(
          run,
          standardNames[index],
        );
        const result = await ensureRunInvoice(run);
        createdInvoices[index] = result.invoice;
        if (result.created) createdCount += 1;
        await preflightReceiptAttachments(
          run,
          standardNames[index],
          receiptSnapshots[index],
        );
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : "Invoice preparation failed. Review this provider and retry.";
        providerErrors.set(
          index,
          `${providers[index].providerName}: ${message}`,
        );
        if (error instanceof AttachmentCapacityError) capacityErrors.add(index);
      }
    }

    let allProductionRows: Awaited<
      ReturnType<typeof fetchCompletedProceduresReport>
    > = [];

    let mappings: Awaited<
      ReturnType<typeof getPraktikaCompletedProcedureMappings>
    > = [];

    let productionSetupFailed = false;
    try {
      [allProductionRows, mappings] = await Promise.all([
        fetchCompletedProceduresReport({
          fromDate: body.fromDate,
          toDate: body.toDate,
        }),
        getPraktikaCompletedProcedureMappings(),
      ]);
    } catch (productionSetupError) {
      productionSetupFailed = true;
      console.error(
        "Failed to load Praktika production rows or mappings",
        productionSetupError,
      );
    }

    const attachmentResults: Array<{
      providerName: string;
      providerId: string;
      invoiceId: string | null;
      statementAttached: boolean;
      productionAttached: boolean;
      productionRowCount: number;
      error?: string;
      receiptResults?: {
        receiptId: string;
        attached: boolean;
        error?: string;
      }[];
    }> = [];

    for (let index = 0; index < createdInvoices.length; index += 1) {
      const invoice = createdInvoices[index];
      const provider = providers[index];
      const run = indexedRuns[index];

      const invoiceId = getInvoiceId(invoice);

      const result = {
        providerId: provider?.providerId,
        providerName: provider?.providerName || `Provider ${index + 1}`,
        invoiceId,
        statementAttached: false,
        productionAttached: false,
        productionRowCount: 0,
        error: undefined as string | undefined,
        receiptResults: [] as {
          receiptId: string;
          attached: boolean;
          error?: string;
        }[],
      };

      if (providerErrors.has(index) || !run) {
        result.error = providerErrors.get(index) || "Invoice run unavailable.";
        attachmentResults.push(result);
        continue;
      }

      if (!provider) {
        result.error = "Provider payload missing for created invoice.";
        attachmentResults.push(result);
        continue;
      }

      if (!invoiceId) {
        console.error("Created Xero invoice missing usable ID:", invoice);

        result.error = `Xero invoice was created for ${provider.providerName}, but no InvoiceID was returned.`;
        attachmentResults.push(result);
        continue;
      }

      try {
        if (!run.statement_attached) {
          const statementPdf = await createServiceFeeStatementPdf({
            providerName: provider.providerName,
            providerAbn: provider.providerAbn || null,
            periodLabel: body.reference,
            logoDataUrl: body.logoDataUrl || null,

            grossProduction: provider.grossProduction,
            adjustments: provider.adjustments,
            labMaterialsExGst: provider.labMaterialsExGst,
            hummFeesExGst: provider.hummFeesExGst,
            afterpayFeesExGst: provider.afterpayFeesExGst,
            ivFacilityFeesNoGst: provider.ivFacilityFeesNoGst,
            otherDeductions: provider.otherDeductions,
            feeBase: provider.feeBase,

            serviceFeeBreakdownLines: provider.serviceFeeBreakdownLines || [],
            serviceFeeExGst: provider.serviceFeeExGst,
            serviceFeeGst: provider.serviceFeeGst,
            serviceFeeIncGst: provider.serviceFeeIncGst,

            labMaterialsGst: provider.labMaterialsGst,
            hummFeesGst: provider.hummFeesGst,
            afterpayFeesGst: provider.afterpayFeesGst,
            totalGst: provider.totalGst,
            feesAndCostsTotalIncGst: provider.feesAndCostsTotalIncGst,

            patientFeesPaidToFocusNoGst: provider.patientFeesPaidToFocusNoGst,
            patientFeesReceivedInErrorNoGst:
              provider.patientFeesReceivedInErrorNoGst,
            patientFeesPaidToAnotherProviderNoGst:
              provider.patientFeesPaidToAnotherProviderNoGst,
            finalTotalDue: provider.finalTotalDue,

            implantEntries: provider.implantEntries || [],
            hummEntries: provider.hummEntries || [],
            afterpayEntries: provider.afterpayEntries || [],
            paidToFocusEntries: provider.paidToFocusEntries || [],
            paidToThisProviderInErrorEntries:
              provider.paidToThisProviderInErrorEntries || [],
            paidToAnotherProviderEntries:
              provider.paidToAnotherProviderEntries || [],
          });

          await xeroUploadInvoiceAttachment(
            invoiceId,
            safeFileName(
              `${provider.providerName} - ${body.reference} - Service Fee Statement.pdf`,
            ),
            statementPdf,
            "application/pdf",
          );

          await markRunAttachment(run, "statement_attached");
        }
        result.statementAttached = true;
      } catch (statementError: any) {
        console.error(
          `Failed to attach statement for ${provider.providerName}`,
          statementError,
        );

        result.error =
          statementError?.message || "Failed to attach statement PDF.";
      }

      try {
        if (!run.production_attached) {
          if (productionSetupFailed)
            throw new Error(
              "Production report data could not be loaded; retry the existing invoice attachments.",
            );
          console.log(
            "Praktika production total rows:",
            allProductionRows.length,
          );

          console.log(
            "Praktika providers found:",
            Array.from(
              new Set(allProductionRows.map((row) => row.providerName)),
            ).sort(),
          );

          console.log(
            "Mappings loaded:",
            mappings.map((mapping) => ({
              provider_id: mapping.provider_id,
              raw_provider_name: mapping.raw_provider_name,
              normalized_provider_name: mapping.normalized_provider_name,
            })),
          );

          console.log("Current Xero provider:", {
            providerId: provider.providerId,
            providerName: provider.providerName,
          });

          const providerProductionRows = filterProductionRowsForProvider({
            providerId: provider.providerId,
            rows: allProductionRows,
            mappings,
          });

          console.log(
            `Matched production rows for ${provider.providerName}:`,
            providerProductionRows.length,
          );

          result.productionRowCount = providerProductionRows.length;

          const productionPdf = await createPraktikaProductionReportPdf({
            providerName: provider.providerName,
            periodLabel: body.reference,
            fromDate: body.fromDate,
            toDate: body.toDate,
            rows: providerProductionRows,
          });

          await xeroUploadInvoiceAttachment(
            invoiceId,
            safeFileName(
              `${provider.providerName} - ${body.reference} - Praktika Production Report.pdf`,
            ),
            productionPdf,
            "application/pdf",
          );

          await markRunAttachment(run, "production_attached");
        }
        result.productionAttached = true;
      } catch (productionError: any) {
        console.error(
          `Failed to attach Praktika production report for ${provider.providerName}`,
          productionError,
        );

        result.error =
          result.error ||
          productionError?.message ||
          "Failed to attach production PDF.";
      }

      try {
        result.receiptResults = await attachPaymentReceipts(
          run,
          receiptSnapshots[index].map((receipt) => receipt.id),
        );
        const remaining = (await loadInvoiceReceipts(run)).filter(
          (receipt) => receipt.status !== "attached",
        );
        if (
          remaining.some(
            (row) =>
              !receiptSnapshots[index].some((receipt) => receipt.id === row.id),
          )
        )
          result.error =
            "Additional receipts were completed after this export began. They remain Pending; retry the billing action to include them.";
        if (result.receiptResults.some((r) => !r.attached))
          result.error =
            result.error ||
            "Some receipt attachments failed. Retry using the same billing action.";
      } catch {
        result.error =
          result.error ||
          "Receipt attachments could not be processed. The invoice is preserved; retry the billing action.";
      }
      attachmentResults.push(result);
    }

    const nonePrepared = createdInvoices.every((invoice) => !invoice);
    return NextResponse.json(
      {
        success: !nonePrepared,
        error: nonePrepared
          ? [...providerErrors.values()].join(" ")
          : undefined,
        createdCount,
        reusedCount: createdInvoices.filter(Boolean).length - createdCount,
        invoices: createdInvoices.filter(Boolean),
        attachmentResults,
      },
      { status: nonePrepared ? (capacityErrors.size ? 409 : 400) : 200 },
    );
  } catch (error: any) {
    if (error instanceof BillingRolloutError)
      return NextResponse.json({ success: false, error: error.message }, { status: error.status, headers: { "Retry-After": "60" } });
    console.error("Create Xero draft invoices error RAW:", error);

    return NextResponse.json(
      {
        success: false,
        error: `${error?.message || "Failed to create Xero draft invoices."} Any invoices already created are preserved; retry will reuse saved invoices.`,
        details: (() => {
          try {
            return JSON.stringify(error, Object.getOwnPropertyNames(error));
          } catch {
            return String(error);
          }
        })(),
      },
      { status: error instanceof AttachmentCapacityError ? 409 : 500 },
    );
  } finally {
    for (const run of lockedRuns) {
      try {
        await releaseInvoiceRun(run);
      } catch {
        console.error("Billing invoice lock requires administrator review", {
          runId: run.id,
        });
      }
    }
    if (exportRequestId) {
      try { await finishBillingExport(exportRequestId); }
      catch { console.error("Billing export drain requires administrator review", { requestId: exportRequestId }); }
    }
  }
}
