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
