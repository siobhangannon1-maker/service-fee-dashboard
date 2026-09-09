import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {mkdtempSync,rmSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Cookie} from 'playwright';
import {createCookieSnapshotStore,COOKIE_SNAPSHOT_MAX_AGE_MS,type SnapshotBinding} from './cookie-snapshot';
const binding:SnapshotBinding={sessionId:'synthetic-session',appUserId:'synthetic-user',scope:'user',profile:'/synthetic/profile',origin:'https://praktika.praktika.net.au'};
const cookies:Cookie[]=['PHPSESSID','UAT'].map(name=>({name,value:'SYNTHETIC_SECRET',domain:'praktika.praktika.net.au',path:'/',secure:true,httpOnly:name==='UAT',sameSite:'None',expires:-1}));
function fixture(t:TestContext){const root=mkdtempSync(path.join(os.tmpdir(),'praktika-snapshot-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('only allowlisted cookies stored, attributes exact, permissions restrictive',t=>{
 const root=fixture(t),store=createCookieSnapshotStore(root,binding);assert.equal(store.capture([...cookies,{...cookies[0],name:'unrelated'}],'source'),true);
 assert.deepEqual(store.load('source').cookies,cookies);
 const dir=path.join(root,'praktika-auth-snapshots'),file=path.join(dir,readdirSync(dir)[0]);
 assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(file).mode&0o777,0o600);assert.doesNotMatch(readFileSync(file,'utf8'),/unrelated/);
});
test('missing, stale, missing cookies, malformed and wrong generation fail closed',t=>{
 const root=fixture(t),store=createCookieSnapshotStore(root,binding);assert.equal(store.load('source').reason,'missing');
 assert.equal(store.capture(cookies.slice(0,1),'source'),false);store.capture(cookies,'source',1000);
 assert.equal(store.load('other',1001).reason,'generation_mismatch');assert.equal(store.load('source',1000+COOKIE_SNAPSHOT_MAX_AGE_MS).reason,'stale');
 store.capture(cookies,'source');const dir=path.join(root,'praktika-auth-snapshots');writeFileSync(path.join(dir,readdirSync(dir)[0]),'SYNTHETIC_SECRET');
 const result=store.load('source');assert.equal(result.cookies,null);assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_SECRET/);
});
test('wrong session, user, scope, profile and origin cannot use snapshot',t=>{
 const root=fixture(t);for(const change of [{sessionId:'other'},{appUserId:'other'},{scope:'practice' as const},{profile:'/other'},{origin:'https://other.invalid'}]){
 createCookieSnapshotStore(root,binding).capture(cookies,'source');assert.equal(createCookieSnapshotStore(root,{...binding,...change}).load('source').cookies,null);
 }
});
test('rotation replaces snapshot and explicit invalidation removes it',t=>{
 const root=fixture(t),store=createCookieSnapshotStore(root,binding);store.capture(cookies,'source');const rotated=cookies.map(c=>({...c,value:'ROTATED_SYNTHETIC'}));store.capture(rotated,'source');assert.deepEqual(store.load('source').cookies,rotated);store.invalidate();assert.equal(store.load('source').reason,'missing');
});
test('unsafe domain, expiry, duplicates and missing auth cookies are rejected',t=>{
 const root=fixture(t),store=createCookieSnapshotStore(root,binding);
 for(const invalid of [[cookies[0],cookies[0]],cookies.map(c=>({...c,domain:'other.invalid'})),cookies.map(c=>({...c,secure:false})),[]])assert.equal(store.capture(invalid,'source'),false);
 store.capture(cookies.map(c=>({...c,expires:1})),'source');assert.equal(store.load('source').reason,'invalid');
});

test('production GST callbacks capture only positive verification; challenges invalidate and transient failure preserves',async t=>{
 const ts=await import('typescript');const {runInNewContext}=await import('node:vm');
 const {createPraktikaAuthenticationGate,validateGstResponse}=await import('./authentication-probe');
 const source=readFileSync('scripts/refresh-praktika-session.ts','utf8');
 const section=source.slice(source.indexOf('const ensureAuthenticated ='),source.indexOf('async function verifyRequestedConnection'));
 const code=ts.transpileModule(section,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [body,status] of [['[]',200],['',307],['',500],['<input type="password">',200],['<input name="otp">',200]] as const){
  const store=createCookieSnapshotStore(fixture(t),binding);store.capture(cookies,'source');let writes=0;const logs:string[]=[];
  const gate=runInNewContext(code+'\nensureAuthenticated',{
   createPraktikaAuthenticationGate,assertOwned:async()=>{},getSession:async()=>({helper_instance_id:"new",helper_heartbeat_at:new Date().toISOString(),authenticated_at:writes?new Date().toISOString():null}),ownedContext:{cookies:async()=>cookies},cookieSnapshots:store,helperInstanceId:'new',shuttingDown:false,isWarmRestoration:true,operationalThisGeneration:false,
   ownedWrite:async()=>{writes++;},probePraktikaAuthentication:async()=>validateGstResponse(status,true,body),process:{env:{PRAKTIKA_PRACTICE_ID:'1'}},PRAKTIKA_BASE_URL:binding.origin,console:{log:(...args:unknown[])=>logs.push(JSON.stringify(args))},
  });
  if(status===200&&body==='[]'){await gate();assert.deepEqual(store.load('new').cookies,cookies);assert.equal(writes,1);}
  else {await assert.rejects(gate());if(status===307||status===500){assert.deepEqual(store.load('source').cookies,cookies);assert.equal(writes,0);}else assert.equal(store.load('source').reason,'missing');}
  assert.doesNotMatch(logs.join(),/SYNTHETIC_SECRET/);
 }
});

test('production one-shot restore uses consumed source binding and GST, never repeated injection',async()=>{
 const ts=await import('typescript');const {runInNewContext}=await import('node:vm');const {PraktikaAuthenticationUnverified}=await import('./authentication-probe');
 const source=readFileSync('scripts/refresh-praktika-session.ts','utf8');
 const start=source.indexOf('    if (isWarmRestoration && !snapshotRestoreAttempted');
 const end=source.indexOf('    await updateSession({',start);
 const code=ts.transpileModule('async function restore(){'+source.slice(start,end)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const outcome of ['success','transient','credentials','mfa','missing','wrong_owner','normal','existing_cookies','visible_mfa']){
  let injections=0,proofs=0,invalidations=0,recoveries=0;const logs:string[]=[];
  const query={select(){return this;},eq(key:string,value:string){if(key==='consumed_instance_id')assert.equal(value,'new');return this;},abortSignal(){return this;},maybeSingle:async()=>({data:outcome==='wrong_owner'?null:{source_instance_id:'source'},error:null})};
  const verify=Object.assign(async()=>{if(outcome==='success'){proofs++;return;}throw new PraktikaAuthenticationUnverified(outcome==='mfa'?'waiting_for_mfa':outcome==='credentials'?'waiting_for_credentials':'error',outcome==='transient');},{resume(){}});
  const globals={isWarmRestoration:outcome!=='normal',snapshotRestoreAttempted:false,pageIsLoginUrl:()=>true,pageHasMfaInput:async()=>outcome==='visible_mfa',pageHasVisiblePasswordInput:async()=>false,context:{cookies:async()=>outcome==='existing_cookies'?cookies:[],addCookies:async(value:Cookie[])=>{assert.deepEqual(value,cookies);injections++;}},assertOwned:async()=>{},supabase:{from:()=>query},session:{id:'synthetic'},helperInstanceId:'new',AbortSignal,cookieSnapshots:{load:(owner:string)=>{assert.equal(owner,'source');return outcome==='missing'?{cookies:null,reason:'missing'}:{cookies};},invalidate(){invalidations++;}},console:{log:(...args:unknown[])=>logs.push(JSON.stringify(args))},shuttingDown:false,page:{goto:async()=>{}},PRAKTIKA_BASE_URL:binding.origin,ensureAuthenticated:verify,loginTransition:true,PraktikaAuthenticationUnverified,KEEP_BROWSER_OPEN:true,keepBrowserOpenForever:async()=>{recoveries++;}};
  const restore=runInNewContext(code+'\nrestore',globals);await restore();await restore();
  assert.equal(injections,['missing','wrong_owner','normal','existing_cookies','visible_mfa'].includes(outcome)?0:1);assert.equal(proofs,outcome==='success'?1:0);
  assert.equal(invalidations,['credentials','mfa'].includes(outcome)?1:0);assert.doesNotMatch(logs.join(),/SYNTHETIC_SECRET/);
  if(injections)assert.equal(recoveries,1);
 }
});

test('capture diagnostics distinguish success, validation skip, deletion and filesystem failure without secrets',t=>{
 const root=fixture(t),events:unknown[]=[];
 const store=createCookieSnapshotStore(root,binding,event=>events.push(event));
 assert.equal(store.capture(cookies,'source'),true);
 assert.equal(store.capture(cookies.slice(0,1),'source'),false);
 const output=JSON.stringify(events);
 assert.match(output,/snapshot_capture_succeeded/);assert.match(output,/missing_required_cookies/);assert.match(output,/capture_invalid/);
 assert.match(output,/required_cookie_count/);assert.match(output,/snapshot_path_hash/);
 assert.doesNotMatch(output,/SYNTHETIC_SECRET/);assert.ok(!output.includes(root));
 const blocked=path.join(root,'blocked');writeFileSync(blocked,'fixture');
 const failures:unknown[]=[];
 assert.equal(createCookieSnapshotStore(blocked,binding,e=>failures.push(e)).capture(cookies,'source'),false);
 assert.match(JSON.stringify(failures),/snapshot_capture_failed/);assert.match(JSON.stringify(failures),/directory/);
 assert.ok(!JSON.stringify(failures).includes(blocked));
});
