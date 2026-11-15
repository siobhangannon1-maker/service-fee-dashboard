import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDraftListInflight} from './draft-list-inflight';
import {readFileSync} from 'node:fs';
test('overlapping provider reads share one load; settled reads are never cached',async()=>{
 const read=createDraftListInflight();let release!:(v:number)=>void,calls=0;
 const load=()=>{calls++;return new Promise<number>(r=>release=r);};
 const a=read('A',load),b=read('A',load);assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
 assert.equal(await read('B',async()=>2),2);release(1);assert.deepEqual(await Promise.all([a,b]),[1,1]);
 assert.equal(await read('A',async()=>3),3);
});
test('failed loads are released, never cached or replayed automatically',async()=>{
 const read=createDraftListInflight();let calls=0;
 const fail=()=>{calls++;throw new Error('synthetic');};
 const a=read('A',fail),b=read('A',fail);await assert.rejects(a);await assert.rejects(b);assert.equal(calls,1);
 assert.equal(await read('A',async()=>4),4);
});
test('each API caller authorises before sharing a read; responses remain no-store',()=>{
 const s=readFileSync('app/api/report-writing/get-drafts/route.ts','utf8');
 assert.ok(s.indexOf('if (accessDenied) return')<s.indexOf('await readInflight('));
 assert.match(s,/searchParams.get\('background'\) === '1'/);assert.match(s,/await readInflight\(providerId \|\| 'all', load\) : await load\(\)/);
 assert.match(s, /private, no-store/);assert.doesNotMatch(s,/setInterval|setTimeout|\.update\(|\.insert\(/);
});
