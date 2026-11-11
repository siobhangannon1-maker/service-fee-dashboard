import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import ExcelJS from "exceljs";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as pdfLib from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { calculateServiceFee } from "../calculations";
import * as charges from "./statement-charge-totals";
import * as labels from "../billing/merchant-fee-labels";
import * as receiptContract from "../billing/receipt-contract";

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Same realm as pdf-lib: its Array validators reject arrays from a VM realm.
  // Every imported dependency is still explicitly supplied; no live integration loads.
  compileFunction(code, ["exports", "require", "process", "console"])(
    exports,
    (name: string) => {
      if (name === "server-only") return {};
      if (!(name in dependencies)) throw Error("Unmocked dependency: " + name);
      return dependencies[name];
    },
    { env: { XERO_TENANT_ID: "synthetic-only" } },
    { log() {}, error() {} },
  );
  return exports as T;
}

function actualFunction<T>(file: string, name: string, context = {}): T {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, name);
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return compileFunction(code + "\nreturn " + name, Object.keys(context))(...Object.values(context)) as T;
}

const provider = { service_fee_type: "flat" as const, service_fee_percent: 40,
  tier_config: null, deduct_adjustments: true, deduct_iv_fees: true };
const manual = { grossProduction: 15000, adjustments: 1000, ivFacilityFees: 100, otherDeductions: 50 };
const auto = { hummFees: 200, afterpayFees: 300, labImplantMaterials: 500,
  feesPaidToFocus: 600, feesOwed: 150, feesPaidInError: 100 };
const input = { serviceFeeExGst: 5140, labMaterialsExGst: 500, hummFeesExGst: 200,
  patientFeesPaidToFocusNoGst: 600, patientFeesPaidToAnotherProviderNoGst: 150,
  patientFeesReceivedInErrorNoGst: 100, ivFacilityFeesNoGst: 100 };

type FeeBase = (p: typeof provider, m: Record<string, number>, a: typeof auto) => number;
test("actual Billing and Financials deduct Afterpay from gross and retain all other deduction flags", () => {
  const billing = actualFunction<FeeBase>("app/(protected)/billing/BillingClient.tsx", "calculateFeeBase");
  const financials = actualFunction<FeeBase>("app/(protected)/financials/FinancialsClient.tsx", "calculateFeeBase");
  const record = { gross_production: 15000, adjustments: 1000, iv_facility_fees: 100, other_deductions: 50 };
  for (const [calculate, fields] of [[billing, manual], [financials, record]] as const) {
    assert.equal(calculate(provider, fields, auto), 12850);
    assert.equal(calculate(provider, fields, { ...auto, afterpayFees: 0 }), 13150);
    assert.equal(calculate({ ...provider, deduct_adjustments: false, deduct_iv_fees: false }, fields, auto), 13950);
  }
  assert.equal(calculateServiceFee(provider, 12850), 5140);
  assert.equal(calculateServiceFee({ ...provider, service_fee_type: "tiered", tier_config: [
    { up_to: 10000, rate: 30 }, { up_to: null, rate: 40 },
  ] }, 12850), 4140);
});

test("Afterpay reimbursement/GST are absent; existing Humm/Zip amount is charged exactly once", () => {
  const stale = { ...input, afterpayFeesExGst: 300, afterpayFeesGst: 30,
    totalGst: 614, feesAndCostsTotalIncGst: 6754, finalTotalDue: 6204 };
  const result = charges.calculateStatementCharges(stale);
  assert.equal(result.afterpayFeesGst, 0);
  assert.equal(result.totalGst, 584);
  assert.equal(result.feesAndCostsTotalIncGst, 6424);
  assert.equal(result.finalTotalDue, 5874);
  assert.equal(result.serviceFeeGst, 514);
  assert.equal(result.labMaterialsGst, 50);
  assert.equal(result.hummFeesGst, 20);
  assert.equal(result.finalTotalDue - charges.calculateStatementCharges({ ...input, hummFeesExGst: 0 }).finalTotalDue, 220);
  assert.deepEqual(charges.calculateStatementCharges(stale), charges.calculateStatementCharges(input));
});

test("existing adjustment signs and Xero line rounding are preserved", () => {
  const result = charges.calculateStatementCharges({ serviceFeeExGst: 12.345, labMaterialsExGst: 3.125,
    hummFeesExGst: 4.125, patientFeesPaidToFocusNoGst: 1.125, patientFeesPaidToAnotherProviderNoGst: 2.125,
    patientFeesReceivedInErrorNoGst: 3.125, ivFacilityFeesNoGst: 4.125 });
  assert.equal(result.serviceFeeExGst, 12.35);
  assert.equal(result.totalGst, 1.96);
  assert.equal(result.finalTotalDue, 25.59);
  assert.equal(charges.calculateStatementCharges({ serviceFeeExGst: 1.15 }).serviceFeeGst, 0.12);
  assert.equal(charges.calculateStatementCharges({ ...input, hummFeesExGst: -200 }).hummFeesGst, -20);
  assert.throws(() => charges.calculateStatementCharges({ serviceFeeExGst: Infinity }), /Invalid/);
});

test("existing historical humm_fee renders the combined label; Afterpay remains separate", () => {
  const categoryLabel = actualFunction<(category: string) => string>("app/billing-details/page.tsx", "categoryLabel", {
    merchantFeeCategoryLabel: labels.merchantFeeCategoryLabel,
  });
  assert.equal(categoryLabel("humm_fee"), "Zip Money and Humm fees");
  assert.equal(categoryLabel("afterpay_fee"), "Afterpay Merchant Fee");
  assert.equal(categoryLabel("incorrect_payment"), "Incorrect Payment");
});

test("actual preview and Excel export preserve existing totals and show the combined fee label", async () => {
  const file = "app/(protected)/billing/BillingClient.tsx";
  const dentist = { ...provider, id: "provider", name: "Dr Synthetic Provider" };
  const feeBase = actualFunction<FeeBase>(file, "calculateFeeBase");
  const calculations = actualFunction<(p: typeof dentist) => {
    feeBase: number; finalTotalDue: number;
  }>(file, "getProviderCalculations", {
    manualBillingData: { provider: manual }, autoTotalsByProvider: { provider: auto },
    emptyManualInputs: {}, calculateFeeBase: feeBase, calculateServiceFee,
  });
  const getProviderCalculations = () => calculations(dentist);
  assert.equal(getProviderCalculations().finalTotalDue, 5804); // Existing card/HTML expense-GST presentation.
  const context = {
    getProviderCalculations, entries: [], billingDetailEntries: [], selectedPeriodId: "period",
    billingPeriods: [{ id: "period", label: "Synthetic month" }], providers: [dentist],
    ZIP_MONEY_HUMM_FEES_LABEL: labels.ZIP_MONEY_HUMM_FEES_LABEL,
    providerStatementHeadings: receiptContract.providerStatementHeadings,
    formatAfterpayEntriesForOutput: () => [],
    PRACTICE: { name: "Synthetic practice", address: "Synthetic address", phone: "", email: "", abn: "" },
  };
  const preview = actualFunction<(p: typeof dentist) => string>(file, "buildStatementPreviewHtml", context)(dentist);
  assert.match(preview, /Zip Money and Humm fees/);
  assert.match(preview, /Afterpay fees \(deducted from gross; not added back\)/);
  assert.match(preview, /5,804\.00/);

  const blobs: Blob[] = [];
  let exported = false;
  const applyValueStyle = actualFunction<(cell: ExcelJS.Cell, bold?: boolean) => void>(file, "applyValueStyle");
  const addLabeledValueRow = actualFunction<(...args: unknown[]) => void>(file, "addLabeledValueRow", { applyValueStyle });
  const exportStatements = actualFunction<() => Promise<void>>(file, "exportProviderStatements", {
    ...context, loadingMetrics: false, setExporting() {}, setMessage() {},
    ExcelJS, addLogoToWorksheet: async () => {}, addLabeledValueRow,
    PRACTICE: { name: "Synthetic practice", address: "Synthetic address", phone: "", email: "", abn: "" },
    sanitizeFileName: (value: string) => value.replaceAll(" ", "_"),
    buildAfterpayMerchantFeeLabel: () => "Afterpay fees",
    writeAuditLog: async () => {}, writeStatementHistory: async () => {},
    showToast(message: string, tone: string) { assert.notEqual(tone, "error", message); exported = true; },
    Blob, URL: { createObjectURL(blob: Blob) { blobs.push(blob); return "synthetic:blob"; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
  });
  await exportStatements();
  assert.equal(exported, true);
  assert.equal(blobs.length, 1);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blobs[0].arrayBuffer());
  const rows: { label: string; value: ExcelJS.CellValue }[] = [];
  workbook.worksheets[0].eachRow(row => rows.push({ label: String(row.getCell(1).value || ""), value: row.getCell(4).value }));
  assert.ok(rows.some(r => r.label === "Zip Money and Humm fees (ex GST)" && r.value === 200));
  assert.ok(rows.some(r => r.label === "Fees and costs total" && r.value === 6424));
  assert.ok(rows.some(r => r.value === 5874));
  assert.ok(rows.some(r => r.label === "Less Afterpay and Zip Money and Humm fees" && r.value === 500));
});

const pdf = load<typeof import("../pdf/createServiceFeeStatementPdf")>("lib/pdf/createServiceFeeStatementPdf.ts", {
  "pdf-lib": pdfLib,
  "@/lib/billing/receipt-contract": receiptContract,
  "@/lib/billing/merchant-fee-labels": labels,
  "@/lib/service-fees/statement-charge-totals": charges,
});
const statementInput = { ...input, ...charges.calculateStatementCharges(input), providerName: "Dr Synthetic Provider",
  periodLabel: "Synthetic month", grossProduction: 15000, adjustments: 1000, otherDeductions: 50,
  afterpayFeesExGst: 300, feeBase: 12850,
  serviceFeeBreakdownLines: [{ label: "40% service fee on net patient fees", amount: 5140 }],
  implantEntries: [], hummEntries: [], afterpayEntries: [], paidToFocusEntries: [],
  paidToThisProviderInErrorEntries: [], paidToAnotherProviderEntries: [] };

async function pdfText(bytes: Buffer) {
  const parser = new PDFParse({ data: bytes });
  try { return (await parser.getText()).text.replace(/\s+/g, " "); }
  finally { await parser.destroy(); }
}

test("actual statement PDF has exact combined headings, Afterpay deductions only and corrected totals", async () => {
  const text = await pdfText(await pdf.createServiceFeeStatementPdf({ ...statementInput,
    afterpayFeesGst: 30, feesAndCostsTotalIncGst: 6754, totalGst: 614, finalTotalDue: 6204 }));
  const additions = text.split("Service fee due")[1].split("Adjustments for patient fees")[0];
  assert.match(additions, /Zip Money and Humm fees 200\.00/);
  assert.equal((additions.match(/Zip Money and Humm fees/g) || []).length, 1);
  assert.doesNotMatch(additions, /Afterpay/);
  assert.match(text, /Less Afterpay fees -300\.00/);
  assert.match(text, /Zip Money and Humm fees NET excluding GST/);
  assert.match(text, /Total fees and costs 6,424\.00/);
  assert.match(text, /Includes GST 584\.00/);
  assert.match(text, /TOTAL DUE TO FOCUS DENTAL 5,874\.00/);
  for (const heading of receiptContract.providerStatementHeadings(statementInput.providerName)) assert.ok(text.includes(heading));
});

type InvoicePayload = { LineItems: { Description: string; UnitAmount: number; TaxType: string; AccountCode: string }[] };
type SyntheticRun = { id: string; invoice_id: string; statement_attached: boolean; production_attached: boolean };
function invoiceHarness() {
  let captured: InvoicePayload | undefined;
  let capturedHash: string | undefined;
  let rejectSavedRun = false;
  let created = false;
  let createCalls = 0;
  let statementBytes: Buffer | undefined;
  const uploadNames: string[] = [];
  const run: SyntheticRun = { id: "synthetic-run", invoice_id: "synthetic-invoice", statement_attached: false, production_attached: false };
  const hashes = load<{ supportingDataHash: (value: unknown) => string }>("lib/billing/xero-invoice-runs.ts", {
    "node:crypto": crypto, "@/lib/supabase/admin": {}, "@/lib/xero": {},
  });
  class BillingRolloutError extends Error { status = 503; }
  class AttachmentCapacityError extends Error { status = 409; }
  const route = load<{ POST: (request: Request) => Promise<Response> }>("app/api/xero/create-service-fee-invoices/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth": { sensitiveApiAccess: async () => null },
    "@/lib/service-fees/statement-charge-totals": charges,
    "@/lib/billing/merchant-fee-labels": labels,
    "@/lib/billing/rollout-maintenance": { beginBillingExport: async () => "synthetic-export", finishBillingExport: async () => {}, BillingRolloutError },
    "@/lib/billing/attachment-capacity": { AttachmentCapacityError },
    "@/lib/supabase/admin": { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: "period", year: 2026, month: 11, label: "Synthetic month" } }) }) }) }) } },
    "@/lib/billing/receipt-destinations": { loadInvoiceReceipts: async () => [] },
    "@/lib/billing/receipt-attachment-preflight": { preflightReceiptAttachments: async () => [] },
    "@/lib/billing/xero-invoice-runs": {
      supportingDataHash: hashes.supportingDataHash,
      acquireInvoiceRun: async (_provider: string, _period: string, payload: InvoicePayload, hash: string) => {
        captured = payload; capturedHash = hash;
        if (rejectSavedRun) throw Error("Provider billing details changed; review existing invoice. No replacement was created.");
        return run;
      },
      ensureRunInvoice: async () => {
        const isNew = !created; if (isNew) createCalls++; created = true;
        return { invoice: { InvoiceID: run.invoice_id }, created: isNew };
      },
      markRunAttachment: async (_run: SyntheticRun, key: "statement_attached" | "production_attached") => { run[key] = true; },
      releaseInvoiceRun: async () => {},
    },
    "@/lib/pdf/createServiceFeeStatementPdf": pdf,
    "@/lib/pdf/createPraktikaProductionReportPdf": { createPraktikaProductionReportPdf: async () => Buffer.from("synthetic report") },
    "@/lib/praktika/fetchCompletedProceduresReport": { fetchCompletedProceduresReport: async () => [] },
    "@/lib/praktika/filterProductionRowsForProvider": { getPraktikaCompletedProcedureMappings: async () => [], filterProductionRowsForProvider: () => [] },
    "@/lib/billing/attach-payment-receipts": { attachPaymentReceipts: async () => [] },
    "@/lib/xero": { xeroUploadInvoiceAttachment: async (_id: string, name: string, data: Buffer) => {
      uploadNames.push(name); if (name.includes("Statement")) statementBytes = data;
    } },
  });
  const send = () => route.POST(new Request("https://synthetic.test/api/xero/create-service-fee-invoices", {
    method: "POST", body: JSON.stringify({ billingPeriodId: "period", invoiceDate: "2026-11-01", dueDate: "2026-11-08",
      providers: [{ ...statementInput, providerId: "provider", afterpayFeesGst: 30,
        totalGst: 614, feesAndCostsTotalIncGst: 6754, finalTotalDue: 6204 }] }),
  }));
  return { send, rejectOldInvoice: () => { rejectSavedRun = true; }, captured: () => captured,
    hash: () => capturedHash, createCalls: () => createCalls, uploads: uploadNames, statement: () => statementBytes };
}

test("real invoice route and actual attached PDF agree despite stale browser Afterpay totals; retry reuses invoice", async () => {
  const h = invoiceHarness();
  const response = await h.send();
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  const items = h.captured()!.LineItems;
  assert.equal(items.filter(i => i.Description === labels.ZIP_MONEY_HUMM_FEES_LABEL).length, 1);
  assert.doesNotMatch(JSON.stringify(items), /Afterpay/);
  assert.deepEqual(items.map(i => i.AccountCode), ["220", "225", "227", "810", "810", "810", "810"]);
  const subtotal = items.reduce((sum, i) => sum + i.UnitAmount, 0);
  const gst = items.filter(i => i.TaxType === "OUTPUT").reduce((sum, i) => sum + Math.round(i.UnitAmount * 10) / 100, 0);
  assert.equal(subtotal + gst, 5874);
  assert.equal(gst, 584);
  assert.match(await pdfText(h.statement()!), /TOTAL DUE TO FOCUS DENTAL 5,874\.00/);
  assert.ok(h.uploads.some(n => n.includes("Praktika Production Report")));
  const before = h.uploads.length;
  const retry = await h.send();
  assert.equal((await retry.json()).reusedCount, 1);
  assert.equal(h.createCalls(), 1);
  assert.equal(h.uploads.length, before);
});

test("previous invoice conflict remains review-required and never creates a replacement or attachments", async () => {
  const h = invoiceHarness(); h.rejectOldInvoice();
  const result = await (await h.send()).json();
  assert.match(JSON.stringify(result), /review existing invoice/i);
  assert.equal(h.createCalls(), 0);
  assert.equal(h.uploads.length, 0);
  assert.ok(h.hash());
});
