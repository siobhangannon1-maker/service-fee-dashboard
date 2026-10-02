import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserContext } from 'playwright';
import { installRefreshObserver, observeProbeResponse, safeObserverPath } from './refresh-observer';
const origin='https://praktika.praktika.net.au';
function fixture(enabled=true, windowMs=30) {
 const context=Object.assign(new EventEmitter(), { cookies:async()=>[{name:'PHPSESSID',value:'SECRET',domain:'PRIVATE',path:'/PRIVATE',secure:true,httpOnly:true,sameSite:'Lax'}],pages:()=>[] });
 const logs:Record<string,unknown>[]=[];
 const observer=installRefreshObserver(context as unknown as BrowserContext,{enabled,origin,generation:'GENERATION',emit:e=>logs.push(e),windowMs});
 return {context,logs,observer,trigger:()=>observer?.response('helper_probe','POST',origin+'/php/json/db_reportingDataWarehouse.php?SECRET',307,{location:'/php/security/db_refreshToken.php?SECRET','set-cookie':'SECRET=SECRET'})};
}
test('off installs no listeners or behavior',()=>{const f=fixture(false);assert.equal(f.observer,undefined);assert.equal(f.context.eventNames().length,0);});
for(const [label,status,location,cookie] of [['arbitrary',307,'/other',true],['external',307,'https://outside.invalid/php/security/db_refreshToken.php',true],['no cookie',307,'/php/security/db_refreshToken.php',false],['wrong status',302,'/php/security/db_refreshToken.php',true]] as const) test(label+' does not trigger',()=>{const f=fixture();f.observer!.response('page','POST',origin, status,{location,...(cookie?{'set-cookie':'SECRET'}:{})});assert.equal(f.logs.length,0);f.observer!.stop('shutdown');});
test('sanitized bounded trace distinguishes page and probe; no secrets/fingerprints',async()=>{
 const f=fixture();await Promise.resolve();f.trigger();
 f.context.emit('request',{url:()=>origin+'/patient/PRIVATE?SECRET',method:()=> 'GET',resourceType:()=> 'xhr'});
 observeProbeResponse(f.context as unknown as BrowserContext,'POST',origin,200,{});
 await new Promise(r=>setTimeout(r,50));
 const text=JSON.stringify(f.logs);assert.doesNotMatch(text,/SECRET|PRIVATE|GENERATION|fingerprint|cookieValue/);assert.match(text,/helper_probe/);assert.match(text,/page/);assert.match(text,/timeout/);assert.equal(f.context.eventNames().length,0);
});
for(const reason of ['context_replaced','ownership_lost','mfa','credentials','shutdown','authenticated'] as const) test(reason+' stops and detaches',()=>{const f=fixture();f.trigger();f.observer!.stop(reason);const n=f.logs.length;f.trigger();assert.equal(f.logs.length,n);assert.equal(f.logs.at(-1)?.reason,reason);assert.equal(f.context.eventNames().length,0);});
test('unknown paths and external paths cannot expose identifiers',()=>{assert.equal(safeObserverPath(origin+'/PATIENT/SECRET?q=SECRET',origin),'[other_same_origin]');assert.equal(safeObserverPath('https://outside.invalid/SECRET',origin),undefined);});
test('passive context needs no request/navigation/cookie mutation capability',()=>{const f=fixture();f.trigger();f.context.emit('close');assert.equal(f.logs.at(-1)?.reason,'context_closed');});
test('second generation installation ends old observation',()=>{const f=fixture();f.trigger();const next=installRefreshObserver(f.context as unknown as BrowserContext,{enabled:true,origin,generation:'second',emit:()=>{}});assert.equal(f.logs.at(-1)?.reason,'context_replaced');next!.stop('shutdown');});
test('ordinary 200 cannot declare authentication',()=>{const f=fixture();f.trigger();f.observer!.response('page','GET',origin+'/v2/',200,{});assert.ok(!f.logs.some(e=>e.reason==='authenticated'));f.observer!.stop('shutdown');});
test('pre-transition authentication leaves observer armed',()=>{const f=fixture();f.observer!.stop('authenticated');f.trigger();assert.equal(f.logs[0]?.event,'start');f.observer!.stop('shutdown');});
