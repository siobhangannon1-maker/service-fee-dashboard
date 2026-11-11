import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import * as contract from "./receipt-contract";
import * as uploadHelpers from "./receipt-upload";
import * as capacityHelpers from "./attachment-capacity";
import * as statementCharges from "../service-fees/statement-charge-totals";
import * as merchantFeeLabels from "./merchant-fee-labels";

test("dynamic statement headings have exactly one Dr prefix", () => {
  for (const name of [
    "Synthetic Dentist",
    "Dr Synthetic Dentist",
    "Dr. Synthetic Dentist",
    "Dr Dr Synthetic Dentist",
  ]) {
    assert.deepEqual(contract.providerStatementHeadings(name), [
      "Patient fees paid to Focus, owed to Dr Synthetic Dentist",
      "Patient fees paid to Dr Synthetic Dentist in error",
      "Patient fees paid to another provider, owed to Dr Synthetic Dentist",
    ]);
  }
});
test("file extensions and signatures must agree", () => {
  assert.equal(
    contract.receiptFileType("test.PDF", Buffer.from("%PDF-1.7")),
    "application/pdf",
  );
  assert.equal(
    contract.receiptFileType("test.jpeg", Buffer.from([255, 216, 255])),
    "image/jpeg",
  );
  assert.equal(
    contract.receiptFileType(
      "test.png",
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
    "image/png",
  );
  assert.throws(() =>
    contract.receiptFileType("evil.pdf", Buffer.from("<script>")),
  );
  assert.throws(() =>
    contract.receiptFileType("evil.svg", Buffer.from("%PDF-1.7")),
  );
});

type Row = Record<string, any>; // Synthetic database records only, deliberately supports several table shapes.
function mockDb(tables: Record<string, Row[]>) {
  if (!tables.incorrect_payment_receipt_destinations)
    tables.incorrect_payment_receipt_destinations = (
      tables.incorrect_payment_receipts || []
    ).map((r) => ({
      receipt_id: r.id,
      provider_id: r.provider_id,
      status: r.status,
      receipt: r,
      xero_invoice_id: null,
      invoice_run_id: null,
      attachment_filename: null,
      xero_attachment_id: null,
      attached_at: null,
      last_error: null,
    }));
  const valueAt = (r: Row, key: string) =>
    key.split(".").reduce((value: Row | undefined, part) => value?.[part], r);

  const db = {
    tables,
    failAttachedSave: false,
    from(table: string) {
      let operation = "read";
      let values: Row = {};
      let filters: ((r: Row) => boolean)[] = [];
      let wantsRows = false;
      const q: any = {
        select() {
          wantsRows = true;
          return q;
        },
        insert(value: Row) {
          operation = "insert";
          values = value;
          return q;
        },
        update(value: Row) {
          operation = "update";
          values = value;
          return q;
        },
        eq(k: string, v: unknown) {
          filters.push((r) => valueAt(r, k) === v);
          return q;
        },
        is(k: string, v: unknown) {
          filters.push((r) => (valueAt(r, k) ?? null) === v);
          return q;
        },
        in(k: string, vs: unknown[]) {
          filters.push((r) => vs.includes(valueAt(r, k)));
          return q;
        },
        neq(k: string, v: unknown) {
          filters.push((r) => valueAt(r, k) !== v);
          return q;
        },
        async single() {
          const result = await execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        async maybeSingle() {
          return q.single();
        },
        then(resolve: (r: unknown) => void, reject: (e: unknown) => void) {
          return execute().then(resolve, reject);
        },
      };
      async function execute() {
        const rows = (tables[table] ||= []);
        if (operation === "insert") {
          if (
            rows.some(
              (r) =>
                r.provider_id === values.provider_id &&
                r.billing_period_id === values.billing_period_id &&
                r.tenant_id === values.tenant_id,
            )
          )
            return { data: null, error: { code: "23505" } };
          rows.push({
            id: "run",
            invoice_id: null,
            creation_attempted: false,
            lock_token: null,
            ...values,
          });
        }
        const selected = rows.filter((r) => filters.every((f) => f(r)));
        if (operation === "update") {
          if (db.failAttachedSave && values.status === "attached") {
            db.failAttachedSave = false;
            return { data: null, error: { message: "synthetic DB failure" } };
          }
          selected.forEach((r) => Object.assign(r, values));
        }
        return {
          data:
            wantsRows || operation === "read"
              ? selected.map((r) => ({ ...r }))
              : null,
          error: null,
        };
      }
      return q;
    },
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([bytes]), error: null }),
      }),
    },
  };
  return db;
}
function loadModule(
  file: string,
  dependencies: Record<string, unknown>,
  environment = {},
) {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    Buffer,
    process: { env: environment },
    require(name: string) {
      if (name in dependencies) return dependencies[name];
      if (name === "server-only") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const bytes = Buffer.from("%PDF-1.7 synthetic receipt");
const sha256 = createHash("sha256").update(bytes).digest("hex");
function receipt(
  id: string,
  provider = "provider",
  period = "period",
  location = "paddington",
): Row {
  return {
    id,
    provider_id: provider,
    billing_period_id: period,
    location,
    status: "pending",
    file_size: bytes.length,
    sha256,
    storage_path: id,
    mime_type: "application/pdf",
    deleted_at: null,
  };
}
function run(): Row {
  return {
    id: "run",
    provider_id: "provider",
    billing_period_id: "period",
    invoice_id: "invoice",
    contact_id: "contact",
    lock_token: "token",
    creation_attempted: true,
  };
}
function destinationModule(db: ReturnType<typeof mockDb>) {
  return loadModule("lib/billing/receipt-destinations.ts", {
    "@/lib/supabase/admin": { supabaseAdmin: db },
  });
}
function target(
  db: ReturnType<typeof mockDb>,
  id: string,
  provider = "provider",
) {
  return db.tables.incorrect_payment_receipt_destinations.find(
    (d) => d.receipt_id === id && d.provider_id === provider,
  )!;
}
function attachmentModule(db: ReturnType<typeof mockDb>, xero: Row) {
  return loadModule("lib/billing/attach-payment-receipts.ts", {
    "./receipt-destinations": destinationModule(db),
    "node:crypto": { createHash },
    "@/lib/supabase/admin": { supabaseAdmin: db },
    "@/lib/xero": xero,
    "./receipt-contract": contract,
  });
}
test("both locations attach only to matching provider/period; retries skip confirmed files", async () => {
  const rows = [
    receipt("one"),
    receipt("two", "provider", "period", "coorparoo"),
    receipt("wrong-provider", "other"),
    receipt("wrong-month", "provider", "other"),
  ];
  const db = mockDb({ incorrect_payment_receipts: rows });
  const uploaded: Row[] = [];
  let fail = true;
  const invoiceIds: string[] = [];
  const module = attachmentModule(db, {
    xeroFetch: async () => ({ Attachments: uploaded }),
    xeroUploadInvoiceAttachment: async (invoiceId: string, name: string) => {
      invoiceIds.push(invoiceId);
      if (fail && name.includes("two")) throw new Error("synthetic timeout");
      const attachment = {
        AttachmentID: name,
        FileName: name,
        ContentLength: bytes.length,
      };
      uploaded.push(attachment);
      return { Attachments: [attachment] };
    },
  });
  const first = await module.attachPaymentReceipts(run());
  assert.equal(first.length, 2);
  assert.equal(target(db, "one").status, "attached");
  assert.equal(target(db, "two").status, "failed");
  assert.equal(target(db, "wrong-provider", "other").status, "pending");
  assert.equal(target(db, "wrong-month").status, "pending");
  fail = false;
  await module.attachPaymentReceipts(run());
  await module.attachPaymentReceipts(run());
  assert.equal(target(db, "two").status, "attached");
  assert.equal(uploaded.length, 2);
  assert.ok(invoiceIds.every((id) => id === "invoice"));
});
test("timeout after Xero accepts file reconciles without duplicate upload", async () => {
  const rows = [receipt("one")];
  const db = mockDb({ incorrect_payment_receipts: rows });
  const uploaded: Row[] = [];
  let calls = 0;
  const module = attachmentModule(db, {
    xeroFetch: async () => ({ Attachments: uploaded }),
    xeroUploadInvoiceAttachment: async (_id: string, name: string) => {
      calls++;
      uploaded.push({
        AttachmentID: "remote",
        FileName: name,
        ContentLength: bytes.length,
      });
      throw new Error("synthetic timeout after commit");
    },
  });
  await module.attachPaymentReceipts(run());
  assert.equal(target(db, "one").status, "failed");
  await module.attachPaymentReceipts(run());
  assert.equal(target(db, "one").status, "attached");
  assert.equal(calls, 1);
});
test("local confirmation failure retries safely using remote attachment list", async () => {
  const rows = [receipt("one")];
  const db = mockDb({ incorrect_payment_receipts: rows });
  db.failAttachedSave = true;
  const remote = {
    AttachmentID: "remote",
    FileName: contract.receiptAttachmentName(rows[0] as contract.Receipt),
    ContentLength: bytes.length,
  };
  const module = attachmentModule(db, {
    xeroFetch: async () => ({ Attachments: [remote] }),
    xeroUploadInvoiceAttachment: async () => {
      throw new Error("Unexpected upload");
    },
  });
  await module.attachPaymentReceipts(run());
  assert.equal(target(db, "one").status, "failed");
  await module.attachPaymentReceipts(run());
  assert.equal(target(db, "one").status, "attached");
});
test("unconfirmed response, storage integrity mismatch and full invoice never mark success", async () => {
  for (const mode of ["confirmation", "integrity", "capacity"]) {
    const rows = [receipt("one")];
    if (mode === "integrity") rows[0].sha256 = "wrong";
    const db = mockDb({ incorrect_payment_receipts: rows });
    let uploads = 0;
    const module = attachmentModule(db, {
      xeroFetch: async () => ({
        Attachments:
          mode === "capacity"
            ? Array.from({ length: 10 }, (_, i) => ({ FileName: String(i) }))
            : [],
      }),
      xeroUploadInvoiceAttachment: async () => {
        uploads++;
        return { Attachments: [] };
      },
    });
    await module.attachPaymentReceipts(run());
    assert.equal(target(db, "one").status, "failed");
    assert.equal(target(db, "one").attached_at, null);
    assert.equal(uploads, mode === "confirmation" ? 1 : 0);
  }
});
function runsModule(
  db: ReturnType<typeof mockDb>,
  fetch: (...args: any[]) => Promise<unknown>,
) {
  return loadModule(
    "lib/billing/xero-invoice-runs.ts",
    {
      "node:crypto": { randomUUID: () => "token", createHash },
      "@/lib/supabase/admin": { supabaseAdmin: db },
      "@/lib/xero": { xeroFetch: fetch },
    },
    { XERO_TENANT_ID: "tenant" },
  );
}
test("saved invoice is reused and contact identity is checked", async () => {
  const db = mockDb({});
  let posts = 0;
  const module = runsModule(db, async (_path, options) => {
    if (options?.method === "POST") posts++;
    return {
      Invoices: [
        {
          InvoiceID: "invoice",
          Contact: { ContactID: "contact" },
          Type: "ACCREC",
          Status: "DRAFT",
        },
      ],
    };
  });
  assert.equal((await module.ensureRunInvoice(run())).created, false);
  assert.equal(posts, 0);
  assert.throws(() =>
    module.verifyInvoice(
      { InvoiceID: "invoice", Contact: { ContactID: "wrong" }, Type: "ACCREC" },
      "contact",
    ),
  );
});
test("uncertain creation blocks another POST even after idempotency expiry", async () => {
  const row = {
    ...run(),
    invoice_id: null,
    invoice_payload: { Reference: "Synthetic month" },
  };
  const db = mockDb({ billing_xero_invoice_runs: [row] });
  let calls = 0;
  const module = runsModule(db, async () => {
    calls++;
    return {};
  });
  await assert.rejects(module.ensureRunInvoice(row), /reconciliation/);
  assert.equal(calls, 0);
});
test("new create stores invoice before attachments; later retry only reads", async () => {
  const row = {
    ...run(),
    invoice_id: null,
    creation_attempted: false,
    invoice_payload: { Reference: "Synthetic month" },
  };
  const db = mockDb({ billing_xero_invoice_runs: [row] });
  let posts = 0;
  const module = runsModule(db, async (path, options) => {
    if (path.includes("?where=")) return { Invoices: [] };
    if (options?.method === "POST") {
      posts++;
      assert.equal(options.headers["Idempotency-Key"], "run");
    }
    return {
      Invoices: [
        {
          InvoiceID: "invoice",
          Contact: { ContactID: "contact" },
          Type: "ACCREC",
          Status: "DRAFT",
        },
      ],
    };
  });
  assert.equal((await module.ensureRunInvoice({ ...row })).created, true);
  assert.equal(row.invoice_id, "invoice");
  assert.equal((await module.ensureRunInvoice({ ...row })).created, false);
  assert.equal(posts, 1);
});
test("existing untracked invoice blocks duplicate creation", async () => {
  const row = {
    ...run(),
    invoice_id: null,
    creation_attempted: false,
    invoice_payload: { Reference: "Synthetic month" },
  };
  const module = runsModule(mockDb({}), async () => ({
    Invoices: [{ InvoiceID: "existing", Status: "DRAFT" }],
  }));
  await assert.rejects(module.ensureRunInvoice(row), /existing invoice/);
});

test("supporting fingerprint ignores query row order but detects changed amounts", () => {
  const module = runsModule(mockDb({}), async () => {
    throw new Error("No network");
  });
  assert.equal(
    module.supportingDataHash({
      entries: [
        { id: "a", amount: 1 },
        { id: "b", amount: 2 },
      ],
    }),
    module.supportingDataHash({
      entries: [
        { amount: 2, id: "b" },
        { amount: 1, id: "a" },
      ],
    }),
  );
  assert.notEqual(
    module.supportingDataHash({ amount: 1 }),
    module.supportingDataHash({ amount: 2 }),
  );
});
test("saved run refuses changed supporting details and releases its lock", async () => {
  const contact = "00000000-0000-4000-8000-000000000001";
  const row = {
    ...run(),
    tenant_id: "tenant",
    contact_id: contact,
    supporting_data_hash: "original",
    lock_token: null,
  };
  const db = mockDb({
    billing_xero_invoice_runs: [row],
    providers: [{ id: "provider", is_active: true, xero_contact_id: contact }],
    billing_periods: [{ id: "period", label: "Synthetic month" }],
  });
  const module = runsModule(db, async () => {
    throw new Error("Unexpected network");
  });
  await assert.rejects(
    module.acquireInvoiceRun("provider", "period", {}, "changed"),
    /billing details/,
  );
  assert.equal(row.lock_token, null);
});

test("saved invoice financial lines cannot retain an old Afterpay charge; label-only retries remain valid", async () => {
  const contact = "00000000-0000-4000-8000-000000000001";
  const humm = { Description: "Humm merchant fees", UnitAmount: 200, Quantity: 1, AccountCode: "227", TaxType: "OUTPUT" };
  const afterpay = { Description: "Afterpay fees", UnitAmount: 300, Quantity: 1, AccountCode: "227", TaxType: "OUTPUT" };
  const payload = { LineItems: [{ ...humm, Description: "Zip Money and Humm fees" }] };
  const row = {
    ...run(), invoice_id: "invoice", tenant_id: "tenant", contact_id: contact, supporting_data_hash: "same-inputs",
    invoice_payload: { LineItems: [humm, afterpay] }, lock_token: null,
  };
  const db = mockDb({ billing_xero_invoice_runs: [row],
    providers: [{ id: "provider", is_active: true, xero_contact_id: contact }],
    billing_periods: [{ id: "period", label: "Synthetic month" }] });
  const module = runsModule(db, async () => { throw Error("No Xero call allowed"); });
  await assert.rejects(module.acquireInvoiceRun("provider", "period", payload, "same-inputs"), /Review the existing invoice/);
  assert.equal(row.lock_token, null);
  assert.equal(row.invoice_id, "invoice");
  assert.equal(row.invoice_payload.LineItems.length, 2);
  // A historical Humm description alone is not a financial conflict.
  row.invoice_payload = { LineItems: [humm] };
  const reused = await module.acquireInvoiceRun("provider", "period", payload, "same-inputs");
  assert.equal(reused.invoice_id, "invoice");
  await module.releaseInvoiceRun(reused);
  assert.equal(row.lock_token, null);
});

function routeModule(file: string, extra: Record<string, unknown>) {
  return loadModule(file, {
    "@/lib/service-fees/statement-charge-totals": statementCharges,
    "@/lib/billing/merchant-fee-labels": merchantFeeLabels,
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/billing/rollout-maintenance": {
      beginBillingExport: async () => "synthetic-request",
      finishBillingExport: async () => {},
      BillingRolloutError: class extends Error {},
    },
    "@/lib/billing/receipt-upload": uploadHelpers,
    "@/lib/billing/attachment-capacity": capacityHelpers,
    "@/lib/billing/receipt-destinations": {
      loadInvoiceReceipts: async () => [],
    },
    "@/lib/billing/receipt-attachment-preflight": {
      preflightReceiptAttachments: async () => [],
    },
    ...extra,
  });
}
test("billing route preserves both original PDFs and reports receipt failure without recreating invoice", async () => {
  const records = {
    billing_periods: [
      { id: "period", label: "Synthetic month", year: 2026, month: 4 },
    ],
  };
  const uploads: string[] = [];
  let capacityBlocked = false;
  let creationCalls = 0;
  let released = 0;
  const invoice = {
    InvoiceID: "invoice",
    Contact: { ContactID: "contact" },
    Type: "ACCREC",
    Status: "DRAFT",
  };
  const module = routeModule(
    "app/api/xero/create-service-fee-invoices/route.ts",
    {
      "@/lib/billing/receipt-attachment-preflight": {
        preflightReceiptAttachments: async (prepared: Row) => {
          if (capacityBlocked && prepared.provider_id !== "allowed")
            throw new capacityHelpers.AttachmentCapacityError(11);
          return [];
        },
      },
      "@/lib/auth": { sensitiveApiAccess: async () => null },
      "@/lib/supabase/admin": { supabaseAdmin: mockDb(records) },
      "@/lib/pdf/createServiceFeeStatementPdf": {
        createServiceFeeStatementPdf: async () =>
          Buffer.from("synthetic statement"),
      },
      "@/lib/pdf/createPraktikaProductionReportPdf": {
        createPraktikaProductionReportPdf: async () =>
          Buffer.from("synthetic production"),
      },
      "@/lib/praktika/fetchCompletedProceduresReport": {
        fetchCompletedProceduresReport: async () => [],
      },
      "@/lib/praktika/filterProductionRowsForProvider": {
        getPraktikaCompletedProcedureMappings: async () => [],
        filterProductionRowsForProvider: () => [],
      },
      "@/lib/xero": {
        xeroUploadInvoiceAttachment: async (id: string, name: string) => {
          assert.equal(id, "invoice");
          uploads.push(name);
        },
      },
      "@/lib/billing/xero-invoice-runs": {
        acquireInvoiceRun: async (providerId: string) => ({
          ...run(),
          provider_id: providerId,
          id: providerId,
        }),
        supportingDataHash: () => "hash",
        ensureRunInvoice: async () => {
          creationCalls++;
          return { invoice, created: false };
        },
        markRunAttachment: async () => {},
        releaseInvoiceRun: async () => {
          released++;
        },
      },
      "@/lib/billing/attach-payment-receipts": {
        attachPaymentReceipts: async () => [
          { receiptId: "one", attached: false, error: "Synthetic failure" },
        ],
      },
    },
  );
  const response = await module.POST(
    new Request("https://local.test/api/xero/create-service-fee-invoices", {
      method: "POST",
      body: JSON.stringify({
        billingPeriodId: "period",
        invoiceDate: "2026-05-01",
        dueDate: "2026-05-08",
        providers: [{ providerId: "provider", providerName: "Dr Synthetic" }],
      }),
    }),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.createdCount, 0);
  assert.equal(result.reusedCount, 1);
  assert.equal(result.attachmentResults[0].statementAttached, true);
  assert.equal(result.attachmentResults[0].productionAttached, true);
  assert.equal(result.attachmentResults[0].receiptResults[0].attached, false);
  assert.ok(result.attachmentResults[0].error);
  assert.equal(uploads.length, 2);
  assert.ok(uploads.some((name) => name.includes("Service Fee Statement")));
  assert.ok(uploads.some((name) => name.includes("Praktika Production")));
  assert.equal(creationCalls, 1);
  assert.equal(released, 1);
  capacityBlocked = true;
  uploads.length = 0;
  const blocked = await module.POST(
    new Request("https://local.test/api/xero/create-service-fee-invoices", {
      method: "POST",
      body: JSON.stringify({
        billingPeriodId: "period",
        providers: [{ providerId: "provider", providerName: "Dr Synthetic" }],
      }),
    }),
  );
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /requires 11 attachments/);
  assert.equal(creationCalls, 1);
  assert.equal(uploads.length, 0);
  assert.equal(released, 2);
  const partial = await module.POST(
    new Request("https://local.test/api/xero/create-service-fee-invoices", {
      method: "POST",
      body: JSON.stringify({
        billingPeriodId: "period",
        providers: [
          { providerId: "allowed", providerName: "Allowed" },
          { providerId: "blocked", providerName: "Blocked" },
        ],
      }),
    }),
  );
  const partialBody = await partial.json();
  assert.equal(partial.status, 200);
  assert.equal(partialBody.attachmentResults.length, 2);
  assert.equal(partialBody.attachmentResults[0].statementAttached, true);
  assert.match(partialBody.attachmentResults[1].error, /requires 11/);
  assert.equal(creationCalls, 2);
});
test("receipt routes reject unauthorised requests before reading request or database", async () => {
  class ApiAuthorizationError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  const auth = {
    ApiAuthorizationError,
    requireActiveApiUser: async () => {
      throw new ApiAuthorizationError(403, "Denied");
    },
  };
  const db = {
    from: () => {
      throw new Error("Unexpected database access");
    },
  };
  for (const [file, methods] of [
    ["app/api/incorrect-payment-receipts/route.ts", ["GET", "POST"]],
    ["app/api/incorrect-payment-receipts/[id]/route.ts", ["GET", "DELETE"]],
  ] as const) {
    const module = routeModule(file, {
      "@/lib/auth": auth,
      "@/lib/supabase/admin": { supabaseAdmin: db },
      "node:crypto": { createHash },
      "@/lib/billing/receipt-contract": contract,
    });
    for (const method of methods) {
      const response = await module[method](
        {
          formData: () => {
            throw new Error("Unexpected body read");
          },
        },
        { params: Promise.resolve({ id: "synthetic" }) },
      );
      assert.equal(response.status, 403);
    }
  }
});

test("multipart receipt parsing enforces size before parsing, including chunked requests", async () => {
  const body = new FormData();
  body.set(
    "file",
    new File([bytes], "synthetic.pdf", { type: "application/pdf" }),
  );
  const form = await uploadHelpers.readReceiptForm(
    new Request("https://local.test/upload", { method: "POST", body }),
  );
  assert.equal((form.get("file") as File).name, "synthetic.pdf");
  await assert.rejects(
    uploadHelpers.readReceiptForm(
      new Request("https://local.test/upload", {
        method: "POST",
        headers: { "Content-Length": "4000000" },
        body: "small",
      }),
    ),
    /Maximum/,
  );
  const chunked = new Request(
    "https://local.test/upload",
    Object.assign(
      {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(3_100_001));
            controller.close();
          },
        }),
      },
      { duplex: "half" },
    ),
  );
  await assert.rejects(uploadHelpers.readReceiptForm(chunked), /Maximum/);
  await assert.rejects(
    uploadHelpers.readReceiptForm(
      new Request("https://local.test/upload", {
        method: "POST",
        body: "not multipart",
      }),
    ),
    /Invalid/,
  );
});

test("read-only mapping validation distinguishes missing, malformed, absent, archived and unavailable contacts", async () => {
  const { validateXeroMappings } = await import("./validate-xero-mappings");
  const ids = Array.from(
    { length: 5 },
    (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`,
  );
  const providers = [null, "bad-id", ...ids, ids[0].toUpperCase()].map(
    (id, index) => ({
      id: String(index),
      name: `Synthetic ${index}`,
      xero_contact_id: id,
    }),
  );
  const reads: string[] = [];
  const result = await validateXeroMappings(providers, async (path) => {
    reads.push(path);
    if (path.endsWith(ids[1])) return { Contacts: [] };
    if (path.endsWith(ids[3]))
      throw new Error("Xero request failed: 404 Not found");
    if (path.endsWith(ids[4])) throw new Error("Synthetic outage");
    return {
      Contacts: [
        {
          ContactID: path.split("/").pop()!,
          Name: "Synthetic contact",
          ContactStatus: path.endsWith(ids[2]) ? "ARCHIVED" : "ACTIVE",
        },
      ],
    };
  });
  assert.deepEqual(
    result.map((r) => r.status),
    [
      "missing",
      "invalid_format",
      "found",
      "not_found",
      "archived",
      "not_found",
      "unverified",
      "found",
    ],
  );
  assert.equal(reads.length, 5);
  assert.ok(reads.every((path) => path.startsWith("/Contacts/")));
  assert.ok(result[2].duplicate && result[7].duplicate);
});
test("mapping validation route denies unauthorised users before database or Xero access", async () => {
  class ApiAuthorizationError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  for (const status of [401, 403]) {
    const module = routeModule(
      "app/api/xero/validate-provider-mappings/route.ts",
      {
        "@/lib/auth": {
          ApiAuthorizationError,
          requireActiveApiUser: async () => {
            throw new ApiAuthorizationError(status, "Denied");
          },
        },
        "@/lib/xero": {
          xeroFetch: () => {
            throw new Error("Unexpected Xero access");
          },
        },
        "@/lib/billing/validate-xero-mappings": {
          validateXeroMappings: () => {
            throw new Error("Unexpected mapping check");
          },
        },
      },
    );
    assert.equal((await module.GET()).status, status);
  }
});

test("invoice attachment budget reserves PDFs, includes manual files and deduplicates retries", () => {
  const standard = ["statement.pdf", "production.pdf"];
  const receipts = Array.from({ length: 8 }, (_, i) => `receipt-${i}.pdf`);
  assert.equal(
    capacityHelpers.assertAttachmentCapacity(receipts, standard),
    10,
  );
  assert.throws(
    () =>
      capacityHelpers.assertAttachmentCapacity(
        [...receipts, "ninth.pdf"],
        standard,
      ),
    /requires 11/,
  );
  assert.equal(
    capacityHelpers.assertAttachmentCapacity(receipts, standard, [
      ...receipts,
      ...standard,
    ]),
    10,
  );
  assert.throws(
    () =>
      capacityHelpers.assertAttachmentCapacity(receipts, standard, [
        "manual.pdf",
      ]),
    /requires 11/,
  );
  assert.equal(
    capacityHelpers.assertAttachmentCapacity(receipts.slice(0, 7), standard, [
      "manual.pdf",
    ]),
    10,
  );
});
test("location-free attachment names are stable and legacy names remain unchanged", () => {
  const base = {
    id: "synthetic",
    mime_type: "application/pdf",
    sha256: "123456789abc0000",
  };
  assert.equal(
    contract.receiptAttachmentName({ ...base, location: null }),
    "Incorrect-payment-synthetic-123456789abc.pdf",
  );
  assert.equal(
    contract.receiptAttachmentName({ ...base, location: "paddington" }),
    "Incorrect-payment-paddington-synthetic-123456789abc.pdf",
  );
  assert.equal(
    contract.receiptAttachmentName({ ...base, location: "coorparoo" }),
    "Incorrect-payment-coorparoo-synthetic-123456789abc.pdf",
  );
});
test("receipt snapshot leaves later uploads pending rather than unexpectedly exporting them", async () => {
  const rows = [receipt("snapshot"), receipt("later")];
  const db = mockDb({ incorrect_payment_receipts: rows });
  const module = attachmentModule(db, {
    xeroFetch: async () => ({ Attachments: [] }),
    xeroUploadInvoiceAttachment: async (_id: string, name: string) => ({
      Attachments: [
        { AttachmentID: "remote", FileName: name, ContentLength: bytes.length },
      ],
    }),
  });
  await module.attachPaymentReceipts(run(), ["snapshot"]);
  assert.equal(target(db, "snapshot").status, "attached");
  assert.equal(target(db, "later").status, "pending");
});
test("real preflight blocks all files when existing attachments plus receipts exceed the limit", async () => {
  const rows = Array.from({ length: 8 }, (_, i) => receipt(String(i)));
  const preflightDb = mockDb({ incorrect_payment_receipts: rows });
  const module = loadModule("lib/billing/receipt-attachment-preflight.ts", {
    "@/lib/supabase/admin": {
      supabaseAdmin: preflightDb,
    },
    "@/lib/xero": {
      xeroFetch: async () => ({ Attachments: [{ FileName: "manual.pdf" }] }),
    },
    "./receipt-destinations": destinationModule(preflightDb),
    "./receipt-contract": contract,
    "./attachment-capacity": capacityHelpers,
  });
  await assert.rejects(
    module.preflightReceiptAttachments(run(), [
      "statement.pdf",
      "production.pdf",
    ]),
    /requires 11/,
  );
  const snapshot = await module.preflightReceiptAttachments(
    { ...run(), invoice_id: null },
    ["statement.pdf", "production.pdf"],
  );
  assert.equal(snapshot.length, 8);
});

test("one original receipt attaches independently to both provider invoices and retries only the failed target", async () => {
  const original = {
    ...receipt("shared", "a"),
    intended_provider_id: "b",
    patient_financial_entry_id: "entry",
  };
  const destinations = ["a", "b"].map((provider) => ({
    receipt_id: "shared",
    provider_id: provider,
    status: "pending",
    receipt: original,
    xero_invoice_id: null,
    invoice_run_id: null,
    attachment_filename: null,
  }));
  const db = mockDb({
    incorrect_payment_receipts: [original],
    incorrect_payment_receipt_destinations: destinations,
    patient_financial_entries: [
      {
        id: "entry",
        provider_id: "a",
        related_provider_id: "b",
        billing_period_id: "period",
        category: "paid_to_wrong_provider",
        deleted_at: null,
      },
    ],
  });
  const remote = new Map<string, Row[]>();
  let fail = true;
  const uploaded: { invoice: string; hash: string }[] = [];
  const module = attachmentModule(db, {
    xeroFetch: async (path: string) => ({
      Attachments: remote.get(path.split("/")[2]) || [],
    }),
    xeroUploadInvoiceAttachment: async (
      invoice: string,
      name: string,
      file: Buffer,
    ) => {
      if (invoice === "invoice-b" && fail) throw new Error("Synthetic failure");
      uploaded.push({
        invoice,
        hash: createHash("sha256").update(file).digest("hex"),
      });
      const attachment = {
        AttachmentID: invoice,
        FileName: name,
        ContentLength: file.length,
      };
      remote.set(invoice, [attachment]);
      return { Attachments: [attachment] };
    },
  });
  const a = { ...run(), provider_id: "a", invoice_id: "invoice-a" },
    b = { ...run(), provider_id: "b", invoice_id: "invoice-b" };
  await module.attachPaymentReceipts(a);
  await module.attachPaymentReceipts(b);
  assert.equal(target(db, "shared", "a").status, "attached");
  assert.equal(target(db, "shared", "b").status, "failed");
  fail = false;
  await module.attachPaymentReceipts(a);
  await module.attachPaymentReceipts(b);
  await module.attachPaymentReceipts(b);
  assert.equal(uploaded.length, 2);
  assert.ok(uploaded.every((u) => u.hash === sha256));
  assert.equal(target(db, "shared", "a").xero_invoice_id, "invoice-a");
  assert.equal(target(db, "shared", "b").xero_invoice_id, "invoice-b");
  assert.equal(db.tables.incorrect_payment_receipts.length, 1);
});
test("draft shared receipts do not enter invoice exports", async () => {
  const original = { ...receipt("draft", "a"), intended_provider_id: "b" };
  const db = mockDb({
    incorrect_payment_receipts: [original],
    incorrect_payment_receipt_destinations: ["a", "b"].map((provider) => ({
      receipt_id: "draft",
      provider_id: provider,
      status: "draft",
      receipt: original,
    })),
  });
  const module = attachmentModule(db, {
    xeroFetch: async () => {
      throw new Error("Unexpected Xero access");
    },
  });
  assert.equal(
    (await module.attachPaymentReceipts({ ...run(), provider_id: "a" })).length,
    0,
  );
  assert.equal(
    (await module.attachPaymentReceipts({ ...run(), provider_id: "b" })).length,
    0,
  );
});
test("billing card selection uses the destination provider status rather than the file owner's status", () => {
  const original = {
    ...receipt("one", "a"),
    destinations: [
      { provider_id: "a", status: "attached", xero_invoice_id: "invoice-a" },
      { provider_id: "b", status: "failed", xero_invoice_id: "invoice-b" },
    ],
  } as contract.Receipt;
  assert.equal(contract.receiptForProvider(original, "a")?.status, "attached");
  assert.equal(contract.receiptForProvider(original, "b")?.status, "failed");
  assert.equal(contract.receiptForProvider(original, "c"), null);
});
