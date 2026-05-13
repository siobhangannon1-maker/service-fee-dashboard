import { NextResponse } from "next/server";
import { createServiceFeeDraftInvoice } from "@/lib/xero/createServiceFeeInvoice";
import { createServiceFeeStatementPdf } from "@/lib/pdf/createServiceFeeStatementPdf";
import { buildServiceFeeBreakdown } from "@/lib/service-fees/buildServiceFeeBreakdown";

type StatementLine = {
  label: string;
  amount?: number;
  bold?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const serviceFeeBreakdownLines = buildServiceFeeBreakdown(
  {
    name: body.providerName,
    service_fee_type: body.service_fee_type,
    service_fee_percent: body.service_fee_percent,
    tier_config: body.tier_config,
  },
  body.netPatientFees
);

    const statementPdf = await createServiceFeeStatementPdf({
      providerName: body.providerName,
      providerAbn: body.providerAbn,
      monthLabel: body.monthLabel,
      lines: [
        { label: "Activity Payments", bold: true },

        ...serviceFeeBreakdownLines,

        {
          label: "Service fee",
          amount: body.serviceFeeExGst,
          bold: true,
        },
        {
          label: "Plus GST",
          amount: body.serviceFeeGst,
        },
        {
          label: "Service fee due",
          amount: body.totalFeesDue,
          bold: true,
        },

        { label: "Add", bold: true },
        {
          label: "Lab / Materials expenses",
          amount: body.labMaterialsExGst,
        },
        {
          label: "Afterpay / Zipmoney / Humm merchant fees",
          amount: body.afterpayZipHummFeesExGst,
        },
        {
          label: "Plus GST",
          amount: body.costsGst,
        },
        {
          label: "Total fees and costs",
          amount: body.feesAndCostsTotal,
          bold: true,
        },
        {
          label: "Includes GST",
          amount: body.totalGst,
        },

        { label: "Adjustments", bold: true },
        {
          label: "Less patient fees paid to Focus",
          amount: body.patientFeesPaidToFocusNoGst,
        },
        {
          label: `Plus patient fees received by ${body.providerName} in error`,
          amount: body.patientFeesReceivedByProviderInErrorNoGst,
        },
        {
          label: "Less patient fees paid to another provider in error",
          amount: body.patientFeesPaidToAnotherProviderNoGst,
        },
        {
          label: "Plus IV Facility Fees",
          amount: body.ivFacilityFeesNoGst,
        },

        {
          label: "TOTAL DUE TO FOCUS DENTAL",
          amount: body.finalTotalDue,
          bold: true,
        },
      ],
    });

    const invoice = await createServiceFeeDraftInvoice({
      providerName: body.providerName,
      providerAbn: body.providerAbn,
      xeroContactId: body.xeroContactId,
      monthLabel: body.monthLabel,
      invoiceDate: body.invoiceDate,
      dueDate: body.dueDate,
      serviceFeeExGst: body.serviceFeeExGst,
      labMaterialsExGst: body.labMaterialsExGst,
      afterpayZipHummFeesExGst: body.afterpayZipHummFeesExGst,
      patientFeesPaidToFocusNoGst: body.patientFeesPaidToFocusNoGst,
      patientFeesReceivedByProviderInErrorNoGst:
        body.patientFeesReceivedByProviderInErrorNoGst,
      patientFeesPaidToAnotherProviderNoGst:
        body.patientFeesPaidToAnotherProviderNoGst,
      ivFacilityFeesNoGst: body.ivFacilityFeesNoGst,
      statementPdfBuffer: statementPdf,
    });

    return NextResponse.json({
      success: true,
      invoiceId: invoice.invoiceID,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
    });
  } catch (error: any) {
    console.error("Create Xero draft invoice error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message ?? "Failed to create Xero draft invoice.",
      },
      { status: 500 }
    );
  }
}