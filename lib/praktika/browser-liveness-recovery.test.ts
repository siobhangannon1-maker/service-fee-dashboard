import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createPraktikaOwnershipRecovery, PraktikaLeaseExpired} from './ownership-recovery';
import {PraktikaOwnershipLost, PraktikaOwnershipRejected, PraktikaOwnershipUnavailable} from './helper-lease';
const source=readFileSync('scripts/refresh-praktika-session.ts','utf8');
const ast=ts.createSourceFile('helper.ts',source,ts.ScriptTarget.Latest,true);
const names=['startHeartbeat','ownedWrite','assertOwned','logOwnershipFailure','getSession'];
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text||'')).map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(cookies:()=>Promise<unknown>, write:()=>Promise<void>=async()=>{}) {
 let tick:()=>void=()=>{},closed=0,released=0;
 const logs:string[]=[];const writes:string[]=[];
 const scope={ownershipLost:false,browserLivenessRecovery:undefined,shuttingDown:false,recoverableExit:false,jobActive:true,
 helperInstanceId:'same-generation',sessionId:'same-session',supabase:{},
 ownershipRecovery:createPraktikaOwnershipRecovery(),PraktikaOwnershipLost,PraktikaOwnershipRejected,PraktikaOwnershipUnavailable,PraktikaLeaseExpired,AbortSignal,
 writePraktikaHelper:async(_db:unknown,session:string,generation:string,action:string)=>{assert.equal(session,'same-session');assert.equal(generation,'same-generation');writes.push(action);await write();},
 shutdownCoordinator:{close:async()=>{closed++;return true;}},releaseOwnership:async()=>{released++;},
 console:{log:(_label:string,value:string)=>logs.push(value)},process:{exitCode:0},
 PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS:10,PRAKTIKA_HELPER_HEARTBEAT_MS:15000,
 setTimeout,clearTimeout,setInterval:(f:()=>void)=>{tick=f;return 1;},clearInterval:()=>{}};
 const api=runInNewContext(code+'\n({startHeartbeat,assertOwned,getSession})',scope);
 const stop=api.startHeartbeat({cookies});
 return {scope,api,writes,logs,stop,tick:()=>tick(),closed:()=>closed,released:()=>released};
}
const turn=()=>new Promise(r=>setImmediate(r));
test('active job: transient failure pauses checks and resumes same owner without closing',async()=>{
 let calls=0;let recover!:()=>void;
 const f=fixture(async()=>{if(++calls===1)throw Error('private cookie detail');await new Promise<void>(r=>{recover=r;});});
 f.tick();await turn();assert.equal(f.closed(),0);assert.equal(f.scope.ownershipLost,false);
 let passed=false;const check=f.api.assertOwned().then(()=>{passed=true;});await turn();assert.equal(passed,false);
 recover();await check;await f.stop();assert.equal(f.closed(),0);assert.equal(f.released(),0);assert.equal(calls,2);
 assert.deepEqual(f.writes,['check','heartbeat','check']);
 assert.deepEqual(JSON.parse(f.logs[0]),{event:'helper_unavailable',generation:'same-generation',cause:'browser_liveness_unavailable'});
 assert.ok(!f.logs.join('').includes('private'));
});
test('persistent failure is bounded to one recheck and fences active work',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('private');});f.tick();await turn();await f.stop();
 assert.equal(calls,2);assert.equal(f.closed(),1);assert.equal(f.scope.ownershipLost,true);await assert.rejects(f.api.assertOwned(),PraktikaOwnershipLost);
});
test('hung browser check times out twice then closes',async()=>{
 let calls=0;const f=fixture(()=>{calls++;return new Promise(()=>{});});f.tick();await new Promise(r=>setTimeout(r,40));await f.stop();
 assert.equal(calls,2);assert.equal(f.closed(),1);
});
for(const [error,cause] of [[new PraktikaOwnershipRejected(),'ownership_rejected'],[new PraktikaLeaseExpired(),'lease_expired']] as const)
 test(cause+' during recovery still fences active job immediately',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('private');},async()=>{throw error;});
 f.tick();await turn();await f.stop();assert.equal(calls,1);assert.ok(f.closed()>0);assert.equal(f.scope.ownershipLost,true);
 assert.ok(f.logs.some(l=>JSON.parse(l).cause===cause));await assert.rejects(f.api.assertOwned(),PraktikaOwnershipLost);
 });
test('authoritative generation mismatch closes with distinct safe cause',async()=>{
 const f=fixture(async()=>[]);const q={select(){return this;},eq(){return this;},abortSignal(){return this;},single:async()=>({data:{helper_instance_id:'replacement'}})};
 Object.assign(f.scope.supabase,{from:()=>q});
 await assert.rejects(f.api.getSession(),PraktikaOwnershipLost);assert.equal(f.closed(),1);assert.equal(JSON.parse(f.logs[0]).cause,'generation_mismatch');await f.stop();
});
test('local lease deadline remains authoritative during recovery',async()=>{
 let now=0;const recovery=createPraktikaOwnershipRecovery({now:()=>now});now=90000;
 await assert.rejects(recovery.run(async()=>{assert.fail('expired owner must not execute');}),PraktikaLeaseExpired);
});
