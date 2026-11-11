import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../lib/report-writing/historical-cleanup-manifest";

// The CLI has no batch exports and runs main at import time. Evaluate its actual
// source with isolated I/O instead of importing it or inventing runtime features.
const source = readFileSync(
  new URL("./historical-workflow-cleanup.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proposal: contract.HistoricalProposal = {
  ok: true,
  draftId: id(1),
  epoch: "synthetic",
  eventId: id(2),
  fingerprint: "a".repeat(64),
  contract: "historical-v1",
  branches: {},
  historicalCompletedAt: null,
};
const manifest: contract.HistoricalManifest = {
  version: 1,
  projectRef: "synthetic",
  generatedAt: "2026-11-11T00:00:00Z",
  executionVersion: "synthetic-v1",
  proposals: [proposal],
};
const text = JSON.stringify(manifest);
type Options = {
  mode?: string;
  omit?: string[];
  digest?: string;
  approve?: boolean;
  manifest?: unknown;
  origin?: string;
  existingOutput?: boolean;
  inspected?: unknown;
  rpcError?: boolean;
};
async function run(options: Options = {}) {
  const values: Record<string, unknown> = {
    mode: options.mode || "dry-run",
    "env-file": "synthetic.env",
    "project-ref": "synthetic",
    manifest: "manifest.json",
    output: "result.json",
    "execution-version": "synthetic-v1",
    "approved-manifest-sha256": options.digest,
    "execute-system-reconciliation": options.approve,
  };
  for (const key of options.omit || []) delete values[key];
  const reads: string[] = [],
    calls: { name: string; args: Record<string, unknown> }[] = [],
    writes: { path: string; data: unknown; exclusive: boolean }[] = [];
  const files = new Map<string, string>(
    options.existingOutput ? [["result.json", "preserve me"]] : [],
  );
  let clientCount = 0,
    networkCalls = 0;
  let guardedFetch:
    | ((input: unknown, init?: RequestInit) => Promise<Response>)
    | undefined;
  const fakeProcess = { exitCode: 0 };
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const cliFs = {
    readFileSync: (path: string) => {
      reads.push(path);
      if (path === "synthetic.env") return Buffer.from("synthetic");
      if (path === "manifest.json")
        return options.manifest === undefined
          ? text
          : JSON.stringify(options.manifest);
      throw Error("Unexpected file read");
    },
    writeFileSync: (path: string, data: string, opts: { flag?: string }) => {
      if (opts.flag === "wx" && files.has(path)) throw Error("Already exists");
      files.set(path, data);
      writes.push({
        path,
        data: JSON.parse(data),
        exclusive: opts.flag === "wx",
      });
    },
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "inspect_historical_workflow")
        return { data: options.inspected ?? proposal, error: null };
      return options.rpcError
        ? { data: null, error: { message: "private synthetic error" } }
        : { data: { ok: true, code: "reconciled" }, error: null };
    },
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of [
        "select",
        "is",
        "in",
        "order",
        "range",
        "eq",
        "not",
        "neq",
      ])
        query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [{ id: id(1), patient_name: "Synthetic Fixture" }],
          error: null,
        }).then(resolve);
      return query;
    },
  };
  vm.runInNewContext(compiled, {
    exports: {},
    Buffer,
    URL,
    Response,
    AbortSignal,
    process: fakeProcess,
    setTimeout: (callback: () => void) => callback(),
    console: { log: finish, error: finish },
    fetch: async () => {
      networkCalls++;
      return Response.json({ synthetic: true });
    },
    require: (name: string) => {
      if (name === "node:fs") return cliFs;
      if (name === "node:util") return { parseArgs: () => ({ values }) };
      if (name === "dotenv")
        return {
          parse: () => ({
            NEXT_PUBLIC_SUPABASE_URL:
              options.origin || "https://synthetic.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "synthetic-key",
          }),
        };
      if (name === "@supabase/supabase-js")
        return {
          createClient: (
            _url: string,
            _key: string,
            config: { global: { fetch: typeof guardedFetch } },
          ) => {
            clientCount++;
            guardedFetch = config.global.fetch;
            return client;
          },
        };
      if (name === "../lib/report-writing/historical-cleanup-manifest")
        return contract;
      throw Error("Unexpected module");
    },
  });
  await finished;
  return {
    reads,
    calls,
    writes,
    files,
    clientCount,
    guardedFetch,
    exitCode: fakeProcess.exitCode,
    networkCalls: () => networkCalls,
  };
}

test("missing explicit environment, project, output or manifest fails before any client is constructed", async () => {
  for (const key of ["env-file", "project-ref", "output", "manifest"]) {
    const r = await run({ omit: [key] });
    assert.equal(r.exitCode, 1);
    assert.equal(r.clientCount, 0);
    assert.equal(r.writes.length, 0);
  }
});
test("project URL mismatch and malformed manifest fail closed", async () => {
  for (const options of [
    { origin: "https://other.supabase.co" },
    { manifest: { ...manifest, projectRef: "other" } },
    {
      manifest: {
        ...manifest,
        proposals: [{ ...proposal, fingerprint: "bad" }],
      },
    },
  ]) {
    const r = await run(options);
    assert.equal(r.exitCode, 1);
    assert.equal(r.clientCount, 0);
  }
});
test("execution requires explicit approval and digest of the complete original manifest", async () => {
  for (const options of [
    { approve: false, digest: contract.manifestDigest(text) },
    { approve: true },
    { approve: true, digest: "wrong" },
  ]) {
    const r = await run({ mode: "execute", ...options });
    assert.equal(r.exitCode, 1);
    assert.equal(r.clientCount, 0);
  }
});
test("dry run inspects and journals without reconciliation or implicit environment reads", async () => {
  const r = await run();
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.reads, ["synthetic.env", "manifest.json"]);
  assert.deepEqual(
    r.calls.map((x) => x.name),
    ["inspect_historical_workflow"],
  );
  assert.ok(r.writes[0].exclusive);
  assert.match(r.files.get("result.json")!, /eligible/);
});
test("approved execution journals pending acknowledgement before the reconciliation result", async () => {
  const r = await run({
    mode: "execute",
    approve: true,
    digest: contract.manifestDigest(text),
  });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(
    r.calls.map((x) => x.name),
    ["inspect_historical_workflow", "reconcile_historical_workflow"],
  );
  assert.equal(r.calls[1].args.p_dry_run, false);
  assert.equal(r.calls[1].args.p_expected_fingerprint, proposal.fingerprint);
  assert.ok(
    r.writes.some((x) =>
      JSON.stringify(x.data).includes("awaiting_acknowledgement"),
    ),
  );
  assert.match(r.files.get("result.json")!, /reconciled/);
});
test("already reconciled, changed or invalidated proposals are not executed", async () => {
  for (const inspected of [
    {
      ...proposal,
      reconciliationState: "active",
      reconciledFingerprint: proposal.fingerprint,
    },
    { ...proposal, fingerprint: "b".repeat(64) },
    { ...proposal, reconciliationState: "invalidated" },
  ]) {
    const r = await run({
      mode: "execute",
      approve: true,
      digest: contract.manifestDigest(text),
      inspected,
    });
    assert.equal(r.exitCode, 0);
    assert.equal(
      r.calls.filter((x) => x.name === "reconcile_historical_workflow").length,
      0,
    );
  }
});
test("existing journal is preserved and prevents inspection or execution", async () => {
  const r = await run({ existingOutput: true });
  assert.equal(r.exitCode, 1);
  assert.equal(r.files.get("result.json"), "preserve me");
  assert.equal(r.calls.length, 0);
});
test("RPC failure preserves pending acknowledgement and does not retry or expose the error", async () => {
  const r = await run({
    mode: "execute",
    approve: true,
    digest: contract.manifestDigest(text),
    rpcError: true,
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.calls.length, 2);
  assert.match(r.files.get("result.json")!, /awaiting_acknowledgement/);
  assert.ok(!r.files.get("result.json")!.includes("private synthetic error"));
});
test("network guard rejects other origins, external jobs, deletes and dry-run reconciliation", async () => {
  const r = await run();
  assert.ok(r.guardedFetch);
  for (const [url, method] of [
    ["https://other.supabase.co/rest/v1/report_drafts", "GET"],
    ["https://synthetic.supabase.co/rest/v1/praktika_helper_jobs", "POST"],
    ["https://synthetic.supabase.co/rest/v1/report_drafts", "DELETE"],
    [
      "https://synthetic.supabase.co/rest/v1/rpc/reconcile_historical_workflow",
      "POST",
    ],
  ])
    await assert.rejects(r.guardedFetch!(url, { method }));
  assert.equal(r.networkCalls(), 0);
  await r.guardedFetch!("https://synthetic.supabase.co/rest/v1/report_drafts");
  assert.equal(r.networkCalls(), 1);
  assert.match(source, /AbortSignal.timeout\(15000\)/);
});
