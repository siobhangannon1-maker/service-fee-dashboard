/** Controlled, sequential database-only tool. No app environment is loaded implicitly.
 * Default: dry-run; --env-file and --project-ref must be explicit.
 * No production execution is authorized by adding this tool.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {parse} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
import {historicalCleanupExcluded,manifestDigest,validHistoricalProposal,retentionImpact,type HistoricalManifest,type HistoricalProposal} from '../lib/report-writing/historical-cleanup-manifest';
const {values}=parseArgs({options:{mode:{type:'string',default:'dry-run'},'env-file':{type:'string'},'project-ref':{type:'string'},manifest:{type:'string'},output:{type:'string'},
 'execution-version':{type:'string'},'approved-manifest-sha256':{type:'string'},'execute-system-reconciliation':{type:'boolean',default:false}}});
async function main(){
 const mode=values.mode!;if(!['manifest','dry-run','retention-impact','execute'].includes(mode)||!values['env-file']||!values['project-ref']||!values.output)throw Error();
 const env=parse(readFileSync(values['env-file']));const origin=`https://${values['project-ref']}.supabase.co`;
 if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin!==origin)throw Error();
 const text=values.manifest?readFileSync(values.manifest,'utf8'):null;
 const manifest:HistoricalManifest|null=text?JSON.parse(text):null;
 if(manifest&&(manifest.version!==1||manifest.projectRef!==values['project-ref']||!manifest.proposals.every(validHistoricalProposal)))throw Error();
 if(mode==='execute'&&(!manifest||!values['execute-system-reconciliation']||values['approved-manifest-sha256']!==manifestDigest(text!)))throw Error();
 if(mode!=='manifest'&&!manifest)throw Error();
 const db=createClient(origin,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
   const url=new URL(String(input)),method=init?.method||'GET';
   const allowed=method==='GET'&&url.pathname==='/rest/v1/report_drafts'||method==='POST'&&url.pathname==='/rest/v1/rpc/inspect_historical_workflow'
     ||mode==='execute'&&method==='POST'&&url.pathname==='/rest/v1/rpc/reconcile_historical_workflow';
   if(url.origin!==origin||!allowed)throw Error();
   return fetch(input,{...init,signal:AbortSignal.timeout(15000)});
 }}});
 const inspect=async(id:string)=>{const {data,error}=await db.rpc('inspect_historical_workflow',{p_draft_id:id});if(error)throw Error();return data;};
 const results:unknown[]=[];let proposals:HistoricalProposal[]=[];
 if(mode==='manifest'){
   if(!values['execution-version']||!/^[a-zA-Z0-9._-]{1,80}$/.test(values['execution-version']))throw Error();
   for(let offset=0;;offset+=100){const {data,error}=await db.from('report_drafts').select('id,patient_name').is('deleted_at',null)
     .in('status',['approved','uploaded_to_praktika']).order('id').range(offset,offset+99);if(error||!data)throw Error();
     for(const d of data){if(historicalCleanupExcluded(d.patient_name)){results.push({draftId:d.id,result:'excluded'});continue;}
       const p=await inspect(d.id);
       if(p?.reconciliationState==='active')results.push({draftId:d.id,result:'already_reconciled'});
       else if(validHistoricalProposal(p)&&p.reconciliationState!=='invalidated')proposals.push(p);
       else results.push({draftId:d.id,result:'blocked'});
       await new Promise(r=>setTimeout(r,100));}
     if(data.length<100)break;
   }
   const output:HistoricalManifest={version:1,projectRef:values['project-ref'],generatedAt:new Date().toISOString(),executionVersion:values['execution-version'],proposals,reviewResults:results};
   writeFileSync(values.output,JSON.stringify(output,null,2),{mode:0o600,flag:'wx'});
 }else{
   proposals=manifest!.proposals;
   writeFileSync(values.output,JSON.stringify({mode,projectRef:values['project-ref'],results}),{mode:0o600,flag:'wx'});
   const journal=()=>writeFileSync(values.output!,JSON.stringify({mode,projectRef:values['project-ref'],results},null,2),{mode:0o600});
   for(const p of proposals){const current=await inspect(p.draftId);
     if(current?.reconciliationState==='active'&&current?.reconciledFingerprint===p.fingerprint){results.push({draftId:p.draftId,result:'already_reconciled'});journal();continue;}
     if(!validHistoricalProposal(current)||current.fingerprint!==p.fingerprint||current?.reconciliationState==='invalidated'){results.push({draftId:p.draftId,result:'changed_or_blocked'});journal();continue;}
     if(mode==='execute'){
       const operation={draftId:p.draftId,result:'awaiting_acknowledgement'};results.push(operation);journal();
       const {data,error}=await db.rpc('reconcile_historical_workflow',{p_draft_id:p.draftId,p_expected_fingerprint:p.fingerprint,p_execution_version:manifest!.executionVersion,p_dry_run:false});
       if(error)throw Error();operation.result=['reconciled','already_reconciled','busy','state_changed'].includes(data?.code)?data.code:'rejected';
     }else if(mode==='retention-impact'){
       const {data:d,error}=await db.from('report_drafts').select('id,sensitive_source_deleted_at,ai_text_deleted_at,final_text_deleted_at').eq('id',p.draftId).single();if(error)throw Error();
       const presence: Record<string,boolean>={};
       for(const [key,column] of [['source','source_text'],['ai','ai_generated_text'],['final','edited_text']]){
         const {data,error}=await db.from('report_drafts').select('id').eq('id',p.draftId).not(column,'is',null).neq(column,'');if(error)throw Error();presence[key]=!!data?.length;
       }
       results.push({draftId:p.draftId,result:'eligible',...retentionImpact(p.historicalCompletedAt,presence as {source:boolean;ai:boolean;final:boolean},
         {source:d.sensitive_source_deleted_at,ai:d.ai_text_deleted_at,final:d.final_text_deleted_at},
         {sourceDays:30,aiDays:30,finalDays:90,deleteFinalText:false}),thresholdAssumption:'defaults; production configuration must be confirmed separately'});
     }else results.push({draftId:p.draftId,result:'eligible',operation:{rpc:'reconcile_historical_workflow',args:{p_draft_id:p.draftId,p_expected_fingerprint:p.fingerprint,p_execution_version:manifest!.executionVersion,p_dry_run:false}}});
     journal();
     await new Promise(r=>setTimeout(r,100));
   }
   writeFileSync(values.output,JSON.stringify({mode,projectRef:values['project-ref'],results},null,2),{mode:0o600});
 }
 console.log(JSON.stringify({mode,proposals:proposals.length,reported:results.length,productionMutation:mode==='execute'}));
}
main().catch(()=>{console.error('Historical cleanup stopped. No automatic retry. Inspect private results and connection/schema availability.');process.exitCode=1;});
