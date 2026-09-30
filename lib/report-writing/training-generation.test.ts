import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const secret='SYNTHETIC_COOKIE_AND_PRIVATE_ERROR';
function fixture(status=200, malformed=false, transport=false){
 const calls:{url:URL;options:RequestInit}[]=[];const exports:Record<string,any>={};
 runInNewContext(compile(readFileSync('lib/report-writing/training-generation.ts','utf8')),{
  exports,URL,Headers,Response,require:()=>({}),fetch:async(url:URL,options:RequestInit)=>{
   calls.push({url,options});if(transport)throw Error(secret);
   return {ok:status>=200&&status<300,status,json:async()=>{if(malformed)throw Error(secret);return status===200?{success:true,report:' Synthetic report '}:{success:false,error:secret};}};
  },
 });return {calls,exports};
}
test('fixed same-origin target receives session cookies on initial generation and regenerated preview',async()=>{
 const f=fixture();const request=new Request('https://trusted.example/api/report-writing/provider-training-cases/train-provider-knowledge',{
  headers:{cookie:secret,'x-forwarded-host':'attacker.example',authorization:'NOT_FORWARDED'},
 });
 for(const payload of [{providerId:'synthetic'},{providerId:'synthetic',temporaryRulesText:'synthetic'}]){
  assert.equal(await f.exports.generateTrainingLetter(request,{...payload,url:'https://attacker.example/steal'}),'Synthetic report');
 }
 assert.equal(f.calls.length,2);
 for(const call of f.calls){
  assert.equal(call.url.href,'https://trusted.example/api/report-writing/generate');
  assert.equal(new Headers(call.options.headers).get('cookie'),secret);
  assert.equal(new Headers(call.options.headers).get('authorization'),null);
  assert.equal(call.options.redirect,'error');assert.equal(call.options.cache,'no-store');
 }
});
for(const status of [400,401,403,422,429,500,307])test(`inner ${status} yields fixed safe response, with no retry`,async()=>{
 const f=fixture(status);let caught:unknown;
 try{await f.exports.generateTrainingLetter(new Request('https://trusted.example/path',{headers:{cookie:secret}}),{});}catch(e){caught=e;}
 const response=f.exports.trainingGenerationErrorResponse(caught);
 assert.equal(response.status,[400,401,403,422,429].includes(status)?status:502);
 assert.ok(!(await response.text()).includes(secret));assert.equal(f.calls.length,1);
});
for(const mode of ['malformed','transport'])test(`${mode} errors do not expose raw text`,async()=>{
 const f=fixture(200,mode==='malformed',mode==='transport');let caught:unknown;
 try{await f.exports.generateTrainingLetter(new Request('https://trusted.example/path'),{});}catch(e){caught=e;}
 const r=f.exports.trainingGenerationErrorResponse(caught);assert.equal(r.status,502);assert.ok(!(await r.text()).includes(secret));assert.equal(f.calls.length,1);
});
for(const [route,count] of [['train-provider-knowledge',2],['train-loop',1],['train-provider-behaviours',2]] as const){
 test(`${route}: every generation call forwards the original request and translates errors`,()=>{
  const source=readFileSync(`app/api/report-writing/provider-training-cases/${route}/route.ts`,'utf8');
  assert.equal((source.match(/await generateTrainingLetter\(req,/g)||[]).length,count);
  assert.ok(!source.includes('await fetch('));
  assert.ok(source.includes('trainingGenerationErrorResponse(error)'));
  assert.ok(source.indexOf('trainingProviderAccess(access.value, providerId)')<source.indexOf('await generateTrainingLetter(req,'));
 });
}
test('smart-dictate uses the same protected forwarding path without leaking response previews',()=>{
 const s=readFileSync('app/api/report-writing/smart-dictate/route.ts','utf8');
 assert.ok(s.includes('await sensitiveApiAccess('));assert.ok(s.includes('await generateTrainingLetter(req,'));assert.ok(!s.includes('generateText.slice'));assert.ok(s.includes('trainingGenerationErrorResponse(error)'));
});
test('/generate remains protected before payload processing',()=>{
 const s=readFileSync('app/api/report-writing/generate/route.ts','utf8');const handler=s.slice(s.indexOf('export async function POST'));
 assert.ok(handler.indexOf('await sensitiveApiAccess(')<handler.indexOf('await req.json()'));
});
