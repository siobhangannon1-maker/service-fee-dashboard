import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PraktikaOwnershipLost } from './helper-lease';
function extract(file: string, names: string[]) {
 const source = readFileSync(file, 'utf8');
 const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 return ts.transpileModule(ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text || '')).map(n => n.getText(ast).replace(/^export /,'')).join('\n'), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const watcher = 'scripts/watch-praktika-refresh.ts';
const helper = 'scripts/refresh-praktika-session.ts';
test('watcher stops claims and releases late claim without spawning; repeated signals are harmless', async () => {
 let resolve!: (v:string)=>void; let spawns=0, releases=0, signals=0;
 const scope = {shuttingDown:false, pollTimer:0, children:new Map([['old',{child:{kill(){signals++;}},owner:'old'}]]),
 running:new Set(), MAX_CONCURRENT_HELPERS:3, checkInProgress:false, console,
 clearInterval(){},setInterval(){return 1;},setTimeout(){return 1;},clearTimeout(){},process:{exit(){},execPath:'node',cwd:()=>'.',platform:'linux'},
 supabase:{},claimPraktikaHelper:()=>new Promise<string>(r=>resolve=r),writePraktikaHelper:async()=>{releases++;},spawn:()=>{spawns++;},
 };
 const api=runInNewContext(extract(watcher,['shutdown','helperCapacityAvailable','startHelperForSession'])+'\n({shutdown,startHelperForSession})',scope);
 const pending=api.startHelperForSession({id:'fixture'},'pending_job'); api.shutdown(); api.shutdown(); resolve('generation');
 assert.equal(await pending,false); assert.equal(spawns,0); assert.equal(releases,1); assert.equal(signals,1);
 assert.equal(await api.startHelperForSession({id:'later'},'pending_job'),false);
 for(const file of [watcher,helper]) for(const signal of ['SIGTERM','SIGINT']) assert.ok(readFileSync(file,'utf8').includes(`process.on("${signal}", shutdown)`));
});
test('idle shutdown closes promptly, active shutdown drains, deadline performs no lease release', () => {
 for(const active of [false,true]) {
 let closes=0, stops=0, exits=0; let deadline!:()=>void;
 const scope={shuttingDown:false,jobActive:active,shutdownDeadline:undefined,renewal:{stop(){stops++;}},ownedContext:{close:async()=>{closes++;}},setTimeout(fn:()=>void){deadline=fn;return 1;},process:{exit(){exits++;}}};
 const shutdown=runInNewContext(extract(helper,['shutdown'])+'\nshutdown',scope);
 shutdown();shutdown();assert.equal(closes,active?0:1);assert.equal(stops,1);deadline();assert.equal(exits,1);
 }
 const source=readFileSync(helper,'utf8');
 assert.match(source,/await stopHeartbeat\(\);[\s\S]*await context.close\(\);\s*await releaseOwnership\(\)/);
 assert.match(source,/while \(!shuttingDown && completedCount/);
});
test('active job completes once during drain; interrupted external request is never retried', async()=>{
 for(const fails of [false,true]) {
 let stopping=false, complete=0, retry=0, operations=0;
 const ownership={assertOwned:async()=>{},ensureAuthenticated:async()=>{},isShuttingDown:()=>stopping};
 const process=runInNewContext(extract('scripts/praktika-helper-job-processor.ts',['processOnePraktikaHelperJob'])+'\nprocessOnePraktikaHelperJob',{
 console:{log(){},error(){}},PraktikaOwnershipLost,claimNextJob:async()=>({id:'fixture',job_type:'fixture',request:{}}),
 runPraktikaRequest:async()=>{operations++;stopping=true;if(fails)throw Error('interrupted');return {};},
 completeJob:async()=>{complete++;},markSessionConnectedForJob:async()=>{},failJob:async()=>{retry++;},
 });
 if(fails)await assert.rejects(process({},'fixture',ownership));else await process({},'fixture',ownership);
 assert.equal(operations,1);assert.equal(complete,fails?0:1);assert.equal(retry,0);
 assert.equal((await process({},'fixture',ownership)).outcome,'none');assert.equal(operations,1);
 }
});
test('release failure preserves fallback and always uses the captured generation', async()=>{
 let calls=0;
 const release=runInNewContext(extract(helper,['releaseOwnership'])+'\nreleaseOwnership',{
 renewal:{stop(){}},ensureAuthenticated:{stop(){}},supabase:{},sessionId:'fixture',helperInstanceId:'old',
 writePraktikaHelper:async(_db:unknown,id:string,owner:string,action:string)=>{
   assert.equal(id,'fixture');assert.equal(owner,'old');assert.equal(action,'release');calls++;throw new PraktikaOwnershipLost();
 },
 });
 await release();assert.equal(calls,1);
});
