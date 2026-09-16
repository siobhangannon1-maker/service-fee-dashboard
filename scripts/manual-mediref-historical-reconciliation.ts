/** One-time human verification importer. Default dry-run; no external workflows.
 * Private manifest and current application access-token files must stay outside Git.
 */
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {parse as parseEnv} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
export const CONTRACT='manual-historical-mediref-v1';
const PROJECT='laolaeigxhgkotchrefj';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export type Entry={draftId:string;epoch:string;fingerprint:string;pdfFingerprint:string;failedJobIds:string[];
 workbookFingerprint:string;eventId:string;contract:typeof CONTRACT};
export type Manifest={contract:typeof CONTRACT;projectRef:string;verifiedAt:string;workbookFingerprint:string;
 exactMatchCount:number;notFoundCount:number;records:Entry[]};
export function verificationId(draftId:string,epoch:string):string {
 const namespace=Buffer.from('66d895a8f9555e36a98c62791e7d92bf','hex');
 const b=createHash('sha1').update(namespace).update(`${draftId}:${epoch}:manual-mediref-v1`).digest().subarray(0,16);
 b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function validateManifest(m:Manifest):void {
 if(Object.keys(m).some(k=>!['contract','projectRef','verifiedAt','workbookFingerprint','exactMatchCount','notFoundCount','records'].includes(k))||m.contract!==CONTRACT||m.projectRef!==PROJECT||!hex(m.workbookFingerprint)||!Number.isFinite(Date.parse(m.verifiedAt))
   ||Date.parse(m.verifiedAt)>Date.now()||Date.parse(m.verifiedAt)<=0||!Number.isInteger(m.exactMatchCount)||m.exactMatchCount<1
   ||!Number.isInteger(m.notFoundCount)||m.notFoundCount<0||!Array.isArray(m.records)||!m.records.length||m.records.length>m.exactMatchCount)throw Error('invalid_manifest');
 const seen=new Set<string>();
 for(const r of m.records){
  if(Object.keys(r).some(k=>!['draftId','epoch','fingerprint','pdfFingerprint','failedJobIds','workbookFingerprint','eventId','contract'].includes(k))||!uuid(r.draftId)||seen.has(r.draftId)||r.contract!==CONTRACT||!uuid(r.eventId)||r.eventId!==verificationId(r.draftId,r.epoch)
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z\/(?:unrecorded|\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)$/.test(r.epoch)
    ||![r.fingerprint,r.pdfFingerprint,r.workbookFingerprint].every(hex)||!Array.isArray(r.failedJobIds)||!r.failedJobIds.length||r.failedJobIds.length>2
    ||!r.failedJobIds.every(uuid)||new Set(r.failedJobIds).size!==r.failedJobIds.length)throw Error('invalid_manifest');
  seen.add(r.draftId);
 }
}
export type Result={ok?:boolean;code?:string;eventId?:string;proposal?:{eventId?:string;failedJobIds?:string[]}};
export interface Store{actor():Promise<string>;verify(args:Record<string,unknown>):Promise<Result>}
export async function runManifest(bytes:Buffer,store:Store,options:{execute?:boolean;approvedSha256?:string}={}){
 const digest=hash(bytes),m=JSON.parse(bytes.toString('utf8')) as Manifest;validateManifest(m);
 if(options.execute&&(!hex(options.approvedSha256)||options.approvedSha256!==digest))throw Error('manifest_approval_required');
 const counts={exactMatch:m.exactMatchCount,eligible:0,stateChanged:0,alreadyVerified:0,superseded:0,conflicting:0,blocked:0,invalidEvidence:0,databaseError:0,verified:0};
 for(const r of m.records){
  // Auth.getUser resolves a current authenticated actor; never use a manifest actor.
  const actor=await store.actor();if(!uuid(actor))throw Error('authentication_required');
  let result:Result;
  try{result=await store.verify({p_draft_id:r.draftId,p_epoch:r.epoch,p_expected_fingerprint:r.fingerprint,p_pdf_fingerprint:r.pdfFingerprint,
    p_workbook_fingerprint:r.workbookFingerprint,p_manifest_fingerprint:digest,p_verifier_user_id:actor,p_verified_at:m.verifiedAt,p_dry_run:!options.execute});}
  catch{counts.databaseError++;if(options.execute)break;continue;}
  if(['eligible','verified','already_verified'].includes(result.code||'') && (result.ok!==true || (!options.execute && result.code==='verified'))) {counts.databaseError++;if(options.execute)break;continue;}
  switch(result.code){
   case 'eligible':counts.eligible++;break;
   case 'verified':counts.verified++;break;
   case 'already_verified':counts.alreadyVerified++;break;
   case 'state_changed':counts.stateChanged++;break;
   case 'superseded':counts.superseded++;break;
   case 'conflicting':counts.conflicting++;break;
   case 'not_eligible':case 'blocked':case 'busy':case 'forbidden':counts.blocked++;break;
   case 'invalid_evidence':counts.invalidEvidence++;break;
   default:counts.databaseError++;
  }
  // Unexpected outcomes stop a mutating batch; never infer success after timeout.
  if(options.execute&&!(result.ok===true&&['verified','already_verified'].includes(result.code||'')))break;
 }
 return {mode:options.execute?'execute':'dry_run',manifestSha256:digest,counts};
}
function privateFile(path:string):string{
 const full=realpathSync(path),repo=realpathSync(resolve(import.meta.dirname,'..'));
 if(full===repo||full.startsWith(repo+'/'))throw Error('private_input_must_be_outside_repository');return full;
}
async function main(){
 const {values}=parseArgs({options:{manifest:{type:'string'},env:{type:'string'},'actor-token-file':{type:'string'},execute:{type:'boolean',default:false},'approved-sha256':{type:'string'}}});
 if(!values.manifest||!values.env||!values['actor-token-file'])throw Error('private_manifest_env_and_actor_token_required');
 const env=parseEnv(readFileSync(values.env)),origin=`https://${PROJECT}.supabase.co`;
 if(env.NEXT_PUBLIC_SUPABASE_URL!==origin||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('project_or_credentials_invalid');
 const tokenFile=privateFile(values['actor-token-file']);
 const db=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const u=new URL(String(input)),method=init?.method||'GET';
  if(u.origin!==origin||!((u.pathname==='/auth/v1/user'&&method==='GET')||
    (u.pathname==='/rest/v1/rpc/verify_historical_mediref_completion'&&method==='POST')))throw Error('request_boundary');
  return fetch(input,{...init,signal:AbortSignal.timeout(30000)});
 }}});
 const store:Store={actor:async()=>{const {data,error}=await db.auth.getUser(readFileSync(tokenFile,'utf8').trim());if(error||!data.user)throw Error('authentication_required');return data.user.id;},
  verify:async args=>{const {data,error}=await db.rpc('verify_historical_mediref_completion',args);if(error)throw Error('database_error');return data as Result;}};
 console.log(JSON.stringify(await runManifest(readFileSync(privateFile(values.manifest)),store,{execute:values.execute,approvedSha256:values['approved-sha256']})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Manual historical MediRef verification stopped; review authentication, manifest and database availability.');process.exitCode=1;});
