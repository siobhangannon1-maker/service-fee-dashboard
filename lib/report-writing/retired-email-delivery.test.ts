import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const path='app/api/report-writing/email-secure-pdf/route.ts';
function retired(denied: Response | null = null) {
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const box={exports:{}};const calls:string[]=[];
 const modules:Record<string,unknown>={'next/server':{NextResponse:{json:Response.json}},'@/lib/auth':{sensitiveApiAccess:async(p:string)=>{calls.push(p);return denied;}}};
 runInNewContext(code,{...box,require:(name:string)=>{assert.ok(name in modules,`Forbidden side-effect dependency: ${name}`);return modules[name];}});
 return {calls,POST:(box.exports as {POST:Function}).POST};
}
test('authenticated legacy POST returns 410 without Resend, PDF, storage, draft, audit or workflow dependencies',async()=>{
 const f=retired();
 const req=new Request('https://fixture.invalid/api/report-writing/email-secure-pdf',{method:'POST',body:'malformed; must never be consumed'});
 Object.defineProperty(req,'json',{value:()=>assert.fail('no body processing')});
 for(let i=0;i<2;i++) {const response=await f.POST(req);assert.equal(response.status,410);assert.deepEqual(await response.json(),{success:false,error:'Report Writing email delivery has been retired. Use MediRef.'});}
 assert.deepEqual(f.calls,[ '/api/report-writing/email-secure-pdf','/api/report-writing/email-secure-pdf']);
 assert.doesNotMatch(readFileSync(path,'utf8'),/withWorkflowOperation|supabase|generateLetterPdf|resend|fetch\(/i);
});
test('retired route preserves authentication denial',async()=>{const f=retired(Response.json({error:'Unauthorized'},{status:401}));assert.equal((await f.POST()).status,401);});
function files(root:string):string[] {return readdirSync(root,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(join(root,x.name)):/\.[cm]?[jt]sx?$/.test(x.name)&&!x.name.includes('.test.')?[join(root,x.name)]:[]);}
const groups:Record<string,string[]>={
 'Typist and Provider':files('app/(protected)/report-writing'),
 'Complete Workflow': ['lib/report-writing/complete-workflow.ts','app/(protected)/report-writing/typist/TypistPage.tsx','app/api/report-writing/continue-praktika-workflow/route.ts'],
 'Resume':files('app/api/report-writing').filter(p=>p.includes('resume')),
 'Resolve':['app/api/report-writing/resolve-workflow/route.ts',...files('lib/report-writing').filter(p=>p.includes('resolution'))],
 'continuation and workers':['app/api/report-writing/continue-praktika-workflow/route.ts',...files('scripts'),...files('lib/mediref'),...files('lib/praktika')],
 'MediRef failure and every Report Writing API':files('app/api/report-writing'),
 'Report Writing shared helpers and components':[...files('lib/report-writing'),...files('components/report-writing')],
};
for(const [label,paths] of Object.entries(groups))test(`${label} cannot send or fall back through Resend`,()=>{
 assert.ok(paths.length);
 for(const p of paths) {
  const source=readFileSync(p,'utf8');
  assert.doesNotMatch(source,/(?:from\s*|require\s*\()\s*['"]resend['"]|\bnew\s+Resend\b|\b\w+\.emails\.send\s*\(/,p);
  assert.doesNotMatch(source,/\/api\/(?:ai-reception\/send-email|send-completion-email|email-statement)/,p);
 }
});
test('unrelated legitimate Resend implementations and dependency are byte-identical',()=>{
 const expected:Record<string,string>={
  'app/api/ai-reception/send-email/route.ts':'c6c126a783f4d68b80e0127794bbd6d16b6a8d44492d5dd6bba2aae21ba957da',
  'app/api/send-completion-email/route.ts':'476ff8095af39b0f8041335b39d7efc986a011719281710a7cc15caaa59af5e7',
  'app/api/email-statement/route.ts':'7a1c1f480bdb433a9e283e970dc4f45a2561792aca33f072e8675fea203ab2ca',
  'package.json':'b9c224133db9478cd2a2c097e280b8757babb9e18533af2e8a1b0b0834869f2b',
  'package-lock.json':'c38ce45146059deaaa2409ba1570b374fea6ecd1d1346537bb89f506e3f98983',
 };
 for(const [p,hash] of Object.entries(expected))assert.equal(createHash('sha256').update(readFileSync(p)).digest('hex'),hash,p);
});

test('only allowlisted unrelated routes import or instantiate Resend in production source',()=>{
 const allowed=['app/api/ai-reception/send-email/route.ts','app/api/email-statement/route.ts','app/api/send-completion-email/route.ts'];
 const found=['app','lib','components','scripts'].flatMap(files).filter(p=>/(?:from\s*|require\s*\()\s*['"]resend['"]|\bnew\s+Resend\b|\b\w+\.emails\.send\s*\(/.test(readFileSync(p,'utf8')));
 assert.deepEqual(found.sort(),allowed.sort());
});
