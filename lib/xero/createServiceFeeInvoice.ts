import { XeroClient, Invoice, LineAmountTypes } from "xero-node";

export type ServiceFeeInvoiceInput = {
  providerName: string;
  providerAbn?: string;
  xeroContactId: string;
  monthLabel: string; // "April 2026"
  invoiceDate: string; // "2026-05-13"
  dueDate: string; // "2026-05-20"

  serviceFeeExGst: number;
  labMaterialsExGst: number;
  afterpayZipHummFeesExGst: number;
  patientFeesPaidToFocusNoGst: number;
  patientFeesReceivedByProviderInErrorNoGst: number;
  patientFeesPaidToAnotherProviderNoGst: number;
  ivFacilityFeesNoGst: number;

  statementPdfBuffer?: Buffer;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export async function createServiceFeeDraftInvoice(input: ServiceFeeInvoiceInput) {
  const xero = new XeroClient({
    clientId: process.env.XERO_CLIENT_ID!,
    clientSecret: process.env.XERO_CLIENT_SECRET!,
    redirectUris: [process.env.XERO_REDIRECT_URI!],
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "accounting.transactions",
      "accounting.attachments",
      "accounting.contacts",
    ],
  });

  await xero.initialize();

  /*
    Replace this with your existing Xero token loading logic.
    You said your API connection already works, so plug your stored tokenSet here.
  */
  const tokenSet = await getStoredXeroTokenSet();
  await xero.setTokenSet(tokenSet);

  if (tokenSet.expired && tokenSet.expired()) {
    const refreshed = await xero.refreshToken();
    await saveXeroTokenSet(refreshed);
  }

  const tenantId = process.env.XERO_TENANT_ID!;

  const invoice: Invoice = {
    type: Invoice.TypeEnum.ACCREC,
    contact: {
      contactID: input.xeroContactId,
    },
    date: input.invoiceDate,
    dueDate: input.dueDate,
    reference: input.monthLabel,
    status: Invoice.StatusEnum.DRAFT,
    lineAmountTypes: LineAmountTypes.Exclusive,
    lineItems: [
      {
        description: `Service fee - ${input.monthLabel}`,
        quantity: 1,
        unitAmount: money(input.serviceFeeExGst),
        accountCode: "200",
        taxType: "OUTPUT",
      },
      {
        description: "Implant/Grafting materials/Guides",
        quantity: 1,
        unitAmount: money(input.labMaterialsExGst),
        accountCode: "200",
        taxType: "OUTPUT",
      },
      {
        description: "Afterpay / Zipmoney / Humm merchant fees",
        quantity: 1,
        unitAmount: money(input.afterpayZipHummFeesExGst),
        accountCode: "200",
        taxType: "OUTPUT",
      },
      {
        description: "Less patient fees paid to Focus",
        quantity: 1,
        unitAmount: money(-input.patientFeesPaidToFocusNoGst),
        accountCode: "200",
        taxType: "NONE",
      },
      {
        description: `Plus patient fees received by ${input.providerName} in error`,
        quantity: 1,
        unitAmount: money(input.patientFeesReceivedByProviderInErrorNoGst),
        accountCode: "200",
        taxType: "NONE",
      },
      {
        description: "Less patient fees paid to another provider in error",
        quantity: 1,
        unitAmount: money(-input.patientFeesPaidToAnotherProviderNoGst),
        accountCode: "200",
        taxType: "NONE",
      },
      {
        description: "Plus IV Facility Fees",
        quantity: 1,
        unitAmount: money(input.ivFacilityFeesNoGst),
        accountCode: "200",
        taxType: "NONE",
      },
    ].filter((line) => Number(line.unitAmount) !== 0),
  };

  const result = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoice],
  });

  const createdInvoice = result.body.invoices?.[0];

  if (!createdInvoice?.invoiceID) {
    throw new Error("Xero invoice was not created.");
  }

  if (input.statementPdfBuffer) {
    await xero.accountingApi.createInvoiceAttachmentByFileName(
      tenantId,
      createdInvoice.invoiceID,
      `${input.providerName} - ${input.monthLabel} Statement.pdf`,
      input.statementPdfBuffer,
      true
    );
  }

  return createdInvoice;
}

/*
  Replace these two functions with your existing Supabase/Xero token storage.
*/
async function getStoredXeroTokenSet(): Promise<any> {
  throw new Error("Connect this to your existing Xero token storage.");
}

async function saveXeroTokenSet(tokenSet: any) {
  console.log("Save refreshed Xero tokenSet", tokenSet);
}