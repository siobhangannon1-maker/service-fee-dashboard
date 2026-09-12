import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createShutdownCoordinator } from './shutdown-coordinator';

test('idle and repeated signal closures share one promise', async () => {
 let closes=0; const events:string[]=[];
 const c=createShutdownCoordinator({close:async()=>{closes++;},active:()=>false,interrupt(){assert.fail();},log:e=>events.push(e),exit(){assert.fail();}});
 c.start();c.start();const p=c.close();assert.equal(p,c.close());assert.equal(await p,true);c.finish();
 assert.equal(closes,1);assert.equal(events.filter(e=>e==='shutdown_started').length,1);
});
test('active safe work drains before one closure',async()=>{
 let active=true,closes=0;
 const c=createShutdownCoordinator({close:async()=>{assert.equal(active,false);closes++;},active:()=>active,interrupt(){assert.fail();},log(){},exit(){assert.fail();}});
 c.start();assert.equal(closes,0);active=false;c.drained();assert.equal(await c.close(),true);c.finish();assert.equal(closes,1);
});
test('drain cut-off reserves cleanup time and marks interruption',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let interrupted=0,closes=0;
 const c=createShutdownCoordinator({close:async()=>{closes++;},active:()=>true,interrupt(){interrupted++;},log(){},exit(){assert.fail();}});
 c.start();t.mock.timers.tick(6999);assert.equal(interrupted,0);t.mock.timers.tick(1);assert.equal(interrupted,1);
 assert.equal(await c.close(),true);assert.equal(closes,1);c.finish();
});
test('slow close never reports success and cannot be restarted',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let finish!:()=>void,closes=0;
 const c=createShutdownCoordinator({close:()=>{closes++;return new Promise<void>(r=>finish=r);},active:()=>false,interrupt(){},log(){},exit(){}});
 const p=c.close();await Promise.resolve();t.mock.timers.tick(5000);assert.equal(await p,false);finish();assert.equal(await c.close(),false);assert.equal(closes,1);c.finish();
});
test('close failure logs category without exception',async()=>{
 const logs:string[]=[];const c=createShutdownCoordinator({close:async()=>{throw Error('SECRET');},active:()=>false,interrupt(){},log:(e,m)=>logs.push(JSON.stringify({e,m})),exit(){}});
 assert.equal(await c.close(),false);assert.match(logs.join(),/browser_close_failed/);assert.doesNotMatch(logs.join(),/SECRET/);c.finish();
});
for(const signal of ['SIGTERM','SIGINT'] as const) test(`real ${signal} invokes helper handler through supervisor`,async()=>{
 const helper=readFileSync('scripts/refresh-praktika-session.ts','utf8');
 const ast=ts.createSourceFile('helper.ts',helper,ts.ScriptTarget.Latest,true);
 const handler=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='shutdown')!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const source=`let shuttingDown=false;const renewal={stop(){}};const shutdownCoordinator={start(){process.send('handled');setTimeout(()=>process.exit(0),20)}};${handler};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);process.send('ready');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['-e',source],{stdio:['ignore','ignore','pipe','ipc']});
 try {
  const result=await new Promise<string>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('signal timeout')),3000);
   child.on('message',m=>{if(m==='ready'){assert.equal(child.kill(signal),true);}if(m==='handled'){clearTimeout(timeout);resolve(String(m));}});
   child.on('error',reject);
  });assert.equal(result,'handled');
 }finally{child.kill('SIGKILL');}
});

test('production cleanup decision: eligible, ineligible and RPC outcomes are safe and observable',async()=>{
 const source=readFileSync('scripts/refresh-praktika-session.ts','utf8');
 const start=source.indexOf('    renewal?.stop();\n    shutdownCoordinator.drained();',source.indexOf('async function refreshOnce'));
 const end=source.indexOf('    logProcessMemory(',start);
 const code=ts.transpileModule(`async function cleanup(){${source.slice(start,end)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const {runInNewContext}=await import('node:vm');
 for(const scenario of ['eligible','ownership_lost','no_operational_history','unresolved_shutdown_work','idle_deadline_expired','processing_job_present','session_status_ineligible','rpc_rejected','rpc_transport_failure','browser_close_failed','not_planned']){
  const events:{event:string,reason?:string}[]=[];let closed=false,releases=0,requests=0;
  const query={select(){return this;},eq(){return this;},is(){return this;},abortSignal(){return this;},single:async()=>({data:{status:scenario==='session_status_ineligible'?'error':'connected',helper_instance_id:'owner',app_user_id:null},error:null}),then(resolve:(v:unknown)=>void){resolve({count:scenario==='processing_job_present'?1:0,error:null});}};
  const globals={renewal:{stop(){}},shutdownCoordinator:{drained(){},close:async()=>{closed=scenario!=='browser_close_failed';return closed;},decision(){},emit:(event:string,reason?:string)=>events.push({event,reason}),finish(){}},
   recoverableExit:false,stopHeartbeat:async()=>{},ownershipLost:scenario==='ownership_lost',shuttingDown:scenario!=='not_planned',operationalThisGeneration:scenario!=='no_operational_history',unresolvedShutdownWork:scenario==='unresolved_shutdown_work',remainingUsefulWorkMs:()=>scenario==='idle_deadline_expired'?0:100000,
   supabase:{from:()=>query},sessionId:'synthetic',helperInstanceId:'owner',hasLivePraktikaHelper:()=>true,AbortSignal,process:{exitCode:0},
   requestPlannedRestoration:async()=>{assert.equal(closed,true);requests++;if(scenario==='rpc_transport_failure')throw Error('SECRET');return scenario!=='rpc_rejected';},
   releaseOwnership:async()=>{assert.equal(closed,true);releases++;},
  };
  await runInNewContext(code+'\ncleanup',globals)();
  if(scenario==='eligible'){assert.equal(requests,1);assert.equal(events[0].event,'restoration_requested');assert.equal(releases,0);}
  else assert.ok(events.some(e=>e.event==='restoration_skipped'&&e.reason===scenario),scenario);
  if(['browser_close_failed','rpc_transport_failure','ownership_lost','unresolved_shutdown_work'].includes(scenario)){assert.equal(releases,0);assert.equal(globals.process.exitCode,75);}
  assert.doesNotMatch(JSON.stringify(events),/SECRET/);
 }
});

test('actual watcher shutdown function delivers SIGTERM to a real helper child',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync('scripts/watch-praktika-refresh.ts','utf8');
 const ast=ts.createSourceFile('watcher.ts',source,ts.ScriptTarget.Latest,true);
 const code=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='shutdown')!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>{process.send('received');process.exit(0)});process.send('ready');setInterval(()=>{},1000);`],{stdio:['ignore','ignore','pipe','ipc']});
 const logs:string[]=[];
 const stop=runInNewContext(code+'\nshutdown',{shuttingDown:false,pollTimer:undefined,children:new Map([['synthetic',{child,owner:'generation'}]]),running:new Set(),checkInProgress:false,setInterval,clearInterval,setTimeout,clearTimeout,process:{exit(){assert.fail('watcher deadline');}},console:{log:(...v:unknown[])=>logs.push(v.join(' '))}});
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('signal timeout')),3000);child.on('message',m=>{if(m==='ready'){stop();stop();}if(m==='received'){clearTimeout(timer);resolve();}});child.on('error',reject);});assert.ok(logs.some(s=>s.includes('"delivered":true')));}finally{child.kill('SIGKILL');}
});
test('SIGKILL bypasses cleanup and cannot publish an intent',async()=>{
 const child=spawn(process.execPath,['-e',`process.on('SIGTERM',()=>process.send('intent'));process.send('ready');setInterval(()=>{},1000);`],{stdio:['ignore','ignore','ignore','ipc']});
 const messages:unknown[]=[];
 await new Promise<void>((resolve,reject)=>{child.on('message',m=>{messages.push(m);if(m==='ready')child.kill('SIGKILL');});child.on('exit',(_code,signal)=>{assert.equal(signal,'SIGKILL');resolve();});child.on('error',reject);});assert.deepEqual(messages,['ready']);
});

test('overall deadline remains 20 seconds and reports stage without releasing',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let exits=0;const logs:string[]=[];
 const c=createShutdownCoordinator({close:()=>new Promise<void>(()=>{}),active:()=>true,interrupt(){},log:(e,m)=>logs.push(JSON.stringify({e,m})),exit(){exits++;}});
 c.start();t.mock.timers.tick(7000);await Promise.resolve();t.mock.timers.tick(5000);await Promise.resolve();
 t.mock.timers.tick(7999);assert.equal(exits,0);t.mock.timers.tick(1);assert.equal(exits,1);
 assert.ok(logs.some(s=>s.includes('shutdown_deadline_exceeded')));assert.ok(logs.some(s=>s.includes('restoration_skipped')));c.finish();
});
