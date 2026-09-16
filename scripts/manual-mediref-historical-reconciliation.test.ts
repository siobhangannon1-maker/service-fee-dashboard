import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {runManifest,validateManifest,verificationId,CONTRACT,type Manifest,type Store} from './manual-mediref-historical-reconciliation';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){const m:Manifest={contract:CONTRACT,projectRef:'laolaeigxhgkotchrefj',verifiedAt:'2026-09-01T00:00:00Z',workbookFingerprint:'a'.repeat(64),exactMatchCount:1,notFoundCount:7,records:[{draftId:id,eventId:verificationId(id,'2026-08-01T00:00:00.000000Z/unrecorded'),epoch:'2026-08-01T00:00:00.000000Z/unrecorded',fingerprint:'b'.repeat(64),pdfFingerprint:'c'.repeat(64),workbookFingerprint:'d'.repeat(64),failedJobIds:[id],contract:CONTRACT}]};return m;}
test('default dry-run derives current actor and passes frozen evidence without creating jobs',async()=>{
 let calls=0;const store:Store={actor:async()=>id,verify:async args=>{calls++;assert.equal(args.p_dry_run,true);assert.equal(args.p_verifier_user_id,id);return {ok:true,code:'eligible'};}};
 const r=await runManifest(Buffer.from(JSON.stringify(fixture())),store);assert.equal(calls,1);assert.equal(r.counts.eligible,1);assert.equal(r.mode,'dry_run');
});
test('execute requires exact approved bytes and default fails before access',async()=>{
 const bytes=Buffer.from(JSON.stringify(fixture()));let called=false;
 const store:Store={actor:async()=>{called=true;return id;},verify:async()=>({ok:true,code:'verified'})};
 await assert.rejects(runManifest(bytes,store,{execute:true}),/manifest_approval_required/);assert.equal(called,false);
 await assert.rejects(runManifest(bytes,store,{execute:true,approvedSha256:'0'.repeat(64)}));
 const r=await runManifest(bytes,store,{execute:true,approvedSha256:createHash('sha256').update(bytes).digest('hex')});assert.equal(r.counts.verified,1);
});
for(const code of ['eligible','state_changed','already_verified','superseded','conflicting','blocked','forbidden','invalid_evidence','unrecognized'])test(`fixed summary for ${code}`,async()=>{
 const r=await runManifest(Buffer.from(JSON.stringify(fixture())),{actor:async()=>id,verify:async()=>({code})});
 assert.equal(Object.values(r.counts).reduce((a,b)=>a+b,0),2);assert.doesNotMatch(JSON.stringify(r),new RegExp(id));
});
test('raw database exceptions never enter summary; execute stops rather than retries',async()=>{
 const m=fixture();m.exactMatchCount=2;m.records.push({...m.records[0],draftId:'22222222-2222-4222-8222-222222222222',eventId:verificationId('22222222-2222-4222-8222-222222222222',m.records[0].epoch)});let calls=0;
 const bytes=Buffer.from(JSON.stringify(m));const r=await runManifest(bytes,{actor:async()=>id,verify:async()=>{calls++;throw Error('sensitive body token patient');}}, {execute:true,approvedSha256:createHash('sha256').update(bytes).digest('hex')});
 assert.equal(calls,1);assert.equal(r.counts.databaseError,1);assert.doesNotMatch(JSON.stringify(r),/sensitive|token|patient/);
});
for(const defect of ['duplicate','empty','project','fingerprint','epoch','jobs','future'])test(`reject manifest ${defect}`,()=>{
 const m=fixture();if(defect==='duplicate'){m.records.push(m.records[0]);m.exactMatchCount=2;}if(defect==='empty')m.records=[];if(defect==='project')m.projectRef='other';if(defect==='fingerprint')m.records[0].fingerprint='bad';if(defect==='epoch')m.records[0].epoch='bad';if(defect==='jobs')m.records[0].failedJobIds=[];if(defect==='future')m.verifiedAt='2099-01-01T00:00:00Z';assert.throws(()=>validateManifest(m));
});
