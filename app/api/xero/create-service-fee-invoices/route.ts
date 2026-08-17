import { NextResponse } from "next/server";
import { createServiceFeeStatementPdf } from "@/lib/pdf/createServiceFeeStatementPdf";
import { createPraktikaProductionReportPdf } from "@/lib/pdf/createPraktikaProductionReportPdf";
import { fetchCompletedProceduresReport } from "@/lib/praktika/fetchCompletedProceduresReport";
import {
  filterProductionRowsForProvider,
  getPraktikaCompletedProcedureMappings,
} from "@/lib/praktika/filterProductionRowsForProvider";
import { xeroFetch, xeroUploadInvoiceAttachment } from "@/lib/xero";

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
  try {
    const body = await request.json();
    const providers = Array.isArray(body.providers) ? body.providers : [];

    if (providers.length === 0) {
      return NextResponse.json(
        { success: false, error: "No providers supplied." },
        { status: 400 }
      );
    }

    if (!body.fromDate || !body.toDate) {
      return NextResponse.json(
        {
          success: false,
          error:
            "fromDate and toDate are required to attach Praktika production reports.",
        },
        { status: 400 }
      );
    }

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
            Description: "Humm merchant fees",
            Quantity: 1,
            UnitAmount: money(provider.hummFeesExGst),
            AccountCode: "227",
            TaxType: "OUTPUT",
          },
          {
            Description: "Afterpay fees",
            Quantity: 1,
            UnitAmount: money(provider.afterpayFeesExGst),
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

    const xeroResult = await xeroFetch("/Invoices", {
      method: "POST",
      body: {
        Invoices: invoicesPayload,
      },
    });

    const createdInvoices = xeroResult?.Invoices || [];

    if (createdInvoices.length === 0) {
      throw new Error(
        `Xero returned no created invoices. Response: ${JSON.stringify(xeroResult)}`
      );
    }

    let allProductionRows: Awaited<
      ReturnType<typeof fetchCompletedProceduresReport>
    > = [];

    let mappings: Awaited<
      ReturnType<typeof getPraktikaCompletedProcedureMappings>
    > = [];

    try {
      [allProductionRows, mappings] = await Promise.all([
        fetchCompletedProceduresReport({
          fromDate: body.fromDate,
          toDate: body.toDate,
        }),
        getPraktikaCompletedProcedureMappings(),
      ]);
    } catch (productionSetupError) {
      console.error(
        "Failed to load Praktika production rows or mappings",
        productionSetupError
      );
    }

    const attachmentResults: Array<{
      providerName: string;
      invoiceId: string | null;
      statementAttached: boolean;
      productionAttached: boolean;
      productionRowCount: number;
      error?: string;
    }> = [];

    for (let index = 0; index < createdInvoices.length; index += 1) {
      const invoice = createdInvoices[index];
      const provider = providers[index];

      const invoiceId = getInvoiceId(invoice);

      const result = {
        providerName: provider?.providerName || `Provider ${index + 1}`,
        invoiceId,
        statementAttached: false,
        productionAttached: false,
        productionRowCount: 0,
        error: undefined as string | undefined,
      };

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
            `${provider.providerName} - ${body.reference} - Service Fee Statement.pdf`
          ),
          statementPdf,
          "application/pdf"
        );

        result.statementAttached = true;
      } catch (statementError: any) {
        console.error(
          `Failed to attach statement for ${provider.providerName}`,
          statementError
        );

        result.error =
          statementError?.message || "Failed to attach statement PDF.";
      }

      try {
        console.log("Praktika production total rows:", allProductionRows.length);

console.log(
  "Praktika providers found:",
  Array.from(new Set(allProductionRows.map((row) => row.providerName))).sort()
);

console.log(
  "Mappings loaded:",
  mappings.map((mapping) => ({
    provider_id: mapping.provider_id,
    raw_provider_name: mapping.raw_provider_name,
    normalized_provider_name: mapping.normalized_provider_name,
  }))
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
  providerProductionRows.length
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
            `${provider.providerName} - ${body.reference} - Praktika Production Report.pdf`
          ),
          productionPdf,
          "application/pdf"
        );

        result.productionAttached = true;
      } catch (productionError: any) {
        console.error(
          `Failed to attach Praktika production report for ${provider.providerName}`,
          productionError
        );

        result.error =
          result.error ||
          productionError?.message ||
          "Failed to attach production PDF.";
      }

      attachmentResults.push(result);
    }

    return NextResponse.json({
      success: true,
      createdCount: createdInvoices.length,
      invoices: createdInvoices,
      attachmentResults,
    });
  } catch (error: any) {
    console.error("Create Xero draft invoices error RAW:", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to create Xero draft invoices.",
        details: (() => {
          try {
            return JSON.stringify(error, Object.getOwnPropertyNames(error));
          } catch {
            return String(error);
          }
        })(),
      },
      { status: 500 }
    );
  }
}
