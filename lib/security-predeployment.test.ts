import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const compile = (s: string) => ts.transpileModule(s, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function handler(path: string, name: string, globals: Record<string, unknown>) {
 const source=readFileSync(path,'utf8'),ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 let found: ts.FunctionDeclaration | undefined;
 function visit(n: ts.Node) { if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n; ts.forEachChild(n,visit); } visit(ast);
 assert.ok(found);
 return runInNewContext(compile(found.getText(ast).replace(/^export /,''))+'\n'+name,globals);
}
test('statement authorized admin retains email behavior using a fake sender',async()=>{
 let sent=0;const fn=handler('app/api/email-statement/route.ts','POST',{
  sensitiveApiAccess:async(_p:string,roles:string[])=>{assert.deepEqual(Array.from(roles),['admin','super_admin']);return null;},NextResponse:{json:Response.json},process:{env:{RESEND_API_KEY:'fake'}},console:{log(){}},
  Resend:class {emails={send:async()=>{sent++;return {data:{id:'fake'}}}}},
 });const r=await fn(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({to:'synthetic@example.invalid',subject:'Synthetic',html:'Synthetic'})}));assert.equal(r.status,200);assert.equal(sent,1);
});
test('authorized Xero request still invokes existing processor',async()=>{
 let calls=0;const fn=handler('app/api/xero-benchmark-report/route.ts','POST',{sensitiveApiAccess:async(_p:string,roles:string[])=>{assert.deepEqual(Array.from(roles),['admin','super_admin']);return null;},NextResponse:{json:Response.json},console:{log(){}},generateExpenseBenchmarkReport:async()=>{calls++;return {success:true}}});
 const r=await fn(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({year:2026,month:9,rows:[{}]})}));assert.equal(r.status,200);assert.equal(calls,1);
});
test('successful patient insert refetches the saved billing period', async () => {
 let refetched = ''; let inserted = 0;
 const q = { insert: () => { inserted++; return q; }, select: () => q, single: async () => ({ data: { id: 'synthetic' }, error: null }) };
 const fn = handler('app/patient-entries/page.tsx', 'saveEntry', {
  activePeriodStatus: 'open', form: { provider_id: 'p', billing_period_id: 'period', patient_name: 'Synthetic', amount: '1', notes: '', category: 'fees_paid_to_focus', entry_date: '2026-09-15' },
  editingEntryId: null, setMessage() {}, setTone() {}, setSaving() {}, supabase: { from: () => q },
  writeAuditLog: async () => {}, resetForm() {}, loadData: async (period: string) => { refetched = period; },
 });
 await fn({ preventDefault() {} }); assert.equal(inserted, 1); assert.equal(refetched, 'period');
});
test('patient form and list filter have distinct category options', () => {
 const source = readFileSync('app/patient-entries/page.tsx', 'utf8');
 const form = source.slice(source.indexOf('<form'), source.indexOf('</form>'));
 assert.match(form, /value=\{form.category\}/); assert.match(form, /value="fees_paid_to_focus"/);
 assert.doesNotMatch(form, /value="fees_owed"/);
 assert.match(source.slice(source.indexOf('</form>')), /value="fees_owed"/);
});
for(const missing of ['MICROSOFT_TENANT_ID','MICROSOFT_CLIENT_ID','MICROSOFT_CLIENT_SECRET'])test('Graph validates lazily: '+missing,async()=>{
 const exports:Record<string,any>={};let requests=0;const env:Record<string,string>={MICROSOFT_TENANT_ID:'fake',MICROSOFT_CLIENT_ID:'fake',MICROSOFT_CLIENT_SECRET:'fake'};delete env[missing];
 runInNewContext(compile(readFileSync('lib/microsoft/graph.ts','utf8')),{exports,require:()=>({}),process:{env},URLSearchParams,fetch:()=>{requests++;throw Error('Unexpected request')}});
 await assert.rejects(exports.listRecentInboxMessages({}),new RegExp('Missing '+missing));assert.equal(requests,0);
});

for (const missing of ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET']) test('Xero validates lazily: ' + missing, async () => {
 const exports: Record<string, any> = {}; let requests = 0;
 const env: Record<string, string> = { XERO_CLIENT_ID: 'fake', XERO_CLIENT_SECRET: 'fake' }; delete env[missing];
 runInNewContext(compile(readFileSync('lib/xero.ts', 'utf8')), { exports, require: () => ({}), process: { env }, fetch: () => { requests++; throw Error('Unexpected request'); } });
 await assert.rejects(exports.getXeroAccessToken(), new RegExp('Missing ' + missing)); assert.equal(requests, 0);
});
