import * as sharedPersistence from "../lib/mediref/persisted-draft";
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { BrowserContext, Page, Request } from "playwright";
import { composeIdentity, inspectPageData, inspectSave, startPersistenceDiagnostic } from "./mediref-persistence-diagnostic";
const id = "synthetic-draft";
const file = { key: `PRIVATE_PREFIX/${id}/PRIVATE_UPLOAD`, s3key: `PRIVATE_PREFIX/${id}/PRIVATE_UPLOAD`, uploadId: "PRIVATE_UPLOAD", originalName: "PRIVATE_FILENAME", size: 123, type: "application/pdf" };
function table(value: unknown): unknown[] {
  const data: unknown[] = [];
  function add(v: unknown): number { const i = data.length; data.push(null); data[i] = Array.isArray(v) ? v.map(add) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k,c]) => [k,add(c)])) : v; return i; }
  add(value); return data;
}
const wire = (v: unknown) => JSON.stringify({ payload: Buffer.from(JSON.stringify(table(v))).toString("base64") });
const data = (files: unknown[], draft = id) => JSON.stringify({ type: "data", nodes: [null, { type: "data", data: table({ draft: { s3uuid: draft, files, patient: { name: "PRIVATE_NAME", dob: "PRIVATE_DOB" } } }) }] });

test("imports are inert, including the launcher", () => {
  for (const name of ["mediref-persistence-diagnostic.ts", "mediref-dob-diagnostic-local.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    const js = ts.transpileModule(source.replaceAll("import.meta.url", '"file:///not-entry"').replaceAll("import.meta.dirname", '"/fixture"'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(js, { exports: {}, require: (name: string) => name === "../lib/mediref/persisted-draft" ? sharedPersistence : ({}), process: { argv: [] }, console: { log: () => assert.fail("output"), error: () => assert.fail("output") } });
  }
});
test("exact compose identity and private same-draft save parsing", () => {
  assert.equal(composeIdentity(`https://www.mediref.com.au/compose/${id}`), id);
  for (const url of [`https://evil.invalid/compose/${id}`, `https://www.mediref.com.au/compose/${id}?other=1`, "https://www.mediref.com.au/login"]) assert.equal(composeIdentity(url), null);
  assert.equal(inspectSave(wire({ s3uuid: "wrong", files: [file] }), id), null);
  assert.equal(inspectSave("malformed PRIVATE", id), null);
  assert.equal(inspectSave(wire({ s3uuid: id, files: [file] }), id)?.files?.length, 1);
});
test("page-data parser handles present, absent, wrong and multiple files without values", () => {
  const present = inspectPageData(data([file]), id, [file]);
  assert.deepEqual(present.filesLocations, ["nodes[1].data.draft.files"]);
  assert.equal(present.attachmentPresent, true); assert.equal(present.persistedFileCount, 1);
  assert.ok("originalName" in present.fileStructure[0]);
  assert.equal(present.fileStructure[0].originalName, "string");
  assert.equal(inspectPageData(data([]), id, [file]).attachmentPresent, false);
  assert.equal(inspectPageData(data([file], "wrong"), id, [file]).attachmentPresent, null);
  const other = { ...file, key: "PRIVATE_OTHER", s3key: "PRIVATE_OTHER", uploadId: "PRIVATE_SECOND" };
  assert.equal(inspectPageData(data([file, other]), id, [file, other]).attachmentPresent, true);
  assert.equal(inspectPageData(data([file]), id, [file, other]).attachmentPresent, false);
  assert.equal(inspectPageData(data([other]), id, [file]).attachmentPresent, false);
  assert.equal(inspectPageData(data([file]), id, []).attachmentPresent, null);
  assert.doesNotMatch(JSON.stringify(present), /PRIVATE|synthetic-draft/);
});
test("malformed, oversized, unsupported tagged and ambiguous nodes fail closed", () => {
  for (const raw of ["PRIVATE_BAD", "x".repeat(256*1024+1), JSON.stringify({type:"data",nodes:[{type:"data",data:[["Date",1],"PRIVATE"]}]}), JSON.stringify({type:"redirect",location:"PRIVATE"})]) {
    const result = inspectPageData(raw,id,[file]); assert.equal(result.attachmentPresent,null); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  const raw = JSON.stringify({type:"data",nodes:[{type:"data",data:table([{s3uuid:id,files:[file]},{s3uuid:id,files:[]}])}]});
  assert.equal(inspectPageData(raw,id,[file]).reason,"ambiguous_draft_data");
});
for (const mode of ["same", "omit", "absent", "timeout", "oversized", "wrong_page"] as const) {
 test(`observer: ${mode}, bounded reads and no writes`, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let pageUrl = `https://www.mediref.com.au/compose/${id}`;
  const page = {url:()=>pageUrl} as Page;
  const context = new EventEmitter() as EventEmitter & { request: unknown };
  const calls: string[] = []; let reads = 0;
  context.request = { get: async (url: string, options: {maxRedirects:number;timeout:number}) => {
    calls.push(url); reads++; assert.equal(options.maxRedirects,0); assert.equal(options.timeout,5000);
    if(mode === "timeout") return new Promise(()=>{});
    const raw = mode === "oversized" ? "x".repeat(256*1024+1) : data(mode === "absent" || mode === "omit" && reads > 1 ? [] : [file]);
    return {ok:()=>true,status:()=>200,url:()=>url,headers:()=>({"content-type":"application/json"}),body:async()=>Buffer.from(raw),dispose:async()=>{}};
  }};
  const capture = startPersistenceDiagnostic(context as unknown as BrowserContext,page);
  const emit = (path: string, value: unknown) => context.emit("request", {frame:()=>({page:()=>page}),method:()=>"POST",url:()=>`https://www.mediref.com.au${path}`,postData:()=>wire(value)} as unknown as Request);
  emit("/_app/remote/1wqh9sd/getUploadParameters",{key:file.key});
  emit("/_app/remote/fd8vn1/saveDraft",{s3uuid:id,files:[file]});
  const pending = capture.finish();
  const settle = async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
  await settle();
  if(mode === "timeout") {t.mock.timers.tick(5500);await settle();}
  if(mode === "omit" || mode === "same") emit("/_app/remote/fd8vn1/saveDraft",{s3uuid:id,...(mode === "same" ? {files:[file]} : {})});
  if(mode === "wrong_page") pageUrl = "https://www.mediref.com.au/compose/other";
  t.mock.timers.tick(12000); await settle();
  if(mode === "timeout") {t.mock.timers.tick(5500); await settle();}
  const result = await pending;
  assert.ok(calls.every(url=>url === `https://www.mediref.com.au/compose/${id}/__data.json`));
  assert.equal(calls.length, mode === "wrong_page" ? 1 : 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|synthetic-draft/);
  assert.equal(context.listenerCount("request"),0); capture.stop();
  if(mode === "same") {assert.equal(result.attachmentPersistedAcrossObservation,true);assert.equal(result.laterSaves[0].laterSaveMatchesPreviouslyObservedFileIdentity,true);}
  if(mode === "omit") {assert.equal(result.initialReadAttachmentPresent,true);assert.equal(result.finalReadAttachmentPresent,false);assert.equal(result.laterSaves[0].laterSaveContainsFiles,false);}
  if(mode === "absent") assert.equal(result.interpretation,"C_absent_at_both_reads");
  if(["timeout","oversized","wrong_page"].includes(mode)) assert.equal(result.interpretation,"D_inconclusive");
 });
}

// Synthetic STANDARD transport variants, not a captured live MediRef payload.
test("standard skip, undefined node, null-prototype record and Date metadata", () => {
  const values = table({draft:{s3uuid:id, files:[file], patient:{name:"PRIVATE_NAME"}}});
  const root = values[0] as Record<string,number>;
  const recordIndex = root.draft;
  const draft = values[recordIndex] as Record<string,number>;
  draft.updated = values.length; values.push(["Date", "PRIVATE_DATE"]);
  values[recordIndex] = ["null", ...Object.entries(draft).flat()];
  const raw = JSON.stringify({type:"data",nodes:[{type:"skip"},{type:"data",data:-1},{type:"data",data:values}]});
  const result = inspectPageData(raw,id,[file]);
  assert.equal(result.decodingSupported,true); assert.equal(result.attachmentPresent,true);
  assert.equal(result.transport.nodeTypeCounts.skip,1);
  assert.equal(result.transport.tagTypeCounts.null,1); assert.equal(result.transport.tagTypeCounts.Date,1);
  assert.equal(result.transport.markers.specialReferences,true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|synthetic-draft|updated/);
});
test("transport classifier emits only allowlisted names and relationships", () => {
  const raw = JSON.stringify({type:"data", PRIVATE_FIELD:"PRIVATE_VALUE",nodes:[{type:"PRIVATE_NODE",data:[{s3uuid:1, files:2, PRIVATE_FIELD:99},"PRIVATE_ID",[3,3],["PRIVATE_TAG","PRIVATE_CONTENT"]]}]});
  const result = inspectPageData(raw,id,[file]);
  assert.equal(result.transport.topLevelType,"object");
  assert.equal(result.transport.nodeTypeCounts.unknown,1); assert.equal(result.transport.tagTypeCounts.unknown,1);
  assert.ok(result.transport.unknownFieldCount >= 2);
  assert.ok(result.transport.references.invalidIndexCount > 0); assert.ok(result.transport.references.repeatedIndexCount > 0);
  assert.ok(result.transport.safeFieldCounts.files > 0); assert.ok(result.transport.arrayCount > 0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test("unknown tags, cycles, invalid indices and malformed records stay inconclusive", () => {
  for (const [values, reason] of [
    [[["PRIVATE_TAG",1],"PRIVATE"],"unknown_tag"],
    [[{self:0}],"cyclic_reference"],
    [[{files:99}],"invalid_reference"],
    [[["null","files"]],"malformed_tag"],
    [[["Date",1],"PRIVATE"],"malformed_tag"],
  ] as const) {
    const result = inspectPageData(JSON.stringify({type:"data",nodes:[{type:"data",data:values}]}),id,[file]);
    assert.equal(result.decodingSupported,false); assert.equal(result.attachmentPresent,null); assert.equal(result.reason,reason);
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
});
test("new standard transport retains absent, wrong-draft and wrong-file results", () => {
  for (const [files,draftId,expected] of [[[],id,false],[[file],"wrong",null],[[{...file,key:"OTHER",s3key:"OTHER"}],id,false]] as const) {
    const raw = JSON.stringify({type:"data",nodes:[{type:"skip"},{type:"data",data:table({draft:{s3uuid:draftId,files}})}]});
    const result = inspectPageData(raw,id,[file]); assert.equal(result.decodingSupported,true);assert.equal(result.attachmentPresent,expected);
  }
});
