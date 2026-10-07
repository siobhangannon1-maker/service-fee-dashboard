import test from 'node:test';
import assert from 'node:assert/strict';
import { productionExecutionSafe, productionJobSettled, productionJobClass } from './production-evidence';
import { isConfirmedPraktikaIcon } from './praktika-icon-result';
import { PERIO_READ_FIELDS } from '../praktika/read-operations';
import type { ReadJob } from './resolved-workflow';
const icons={appointment_icon1id:0,appointment_icon2id:6597,appointment_icon3id:0,appointment_icon4id:0};
const iconRequest={method:'POST',path:'/php/forms/db_commitFormData.php',contentType:'json',body:[{practice_id:1181,appointment_id:456,...icons}]};
const icon:ReadJob={id:'icon',job_type:'update_praktika_letter_icons',status:'completed',request:iconRequest,response:icons,locked_by:'retained-owner',locked_at:'2026-01-01'};
test('real four-slot icon receipt and retained terminal lock are settled',()=>assert.equal(productionJobSettled(icon),true));
for(const result of [{saved:true},{appointment_icon_saved:true},{appointment_icon2id:6597},{...icons,appointment_icon4id:null},{...icons,appointment_icon4id:-1},{...icons,appointment_icon2id:7341},{...icons,error:'synthetic'},{...icons,errors:[]}])test('malformed/partial/contradictory icon result '+JSON.stringify(result),()=>assert.equal(isConfirmedPraktikaIcon(result),false));
test('icon result must match requested slots',()=>assert.equal(productionJobSettled({...icon,response:{...icons,appointment_icon1id:7360}}),false));
test('completed upload retained lock is settled only with file receipt',()=>{
 const j:ReadJob={id:'upload',status:'completed',job_type:'upload_report_to_praktika',response:{patient_communication:{iFileId:42}},locked_by:'retained',locked_at:'2026-01-01'};
 assert.equal(productionJobSettled(j),true);assert.equal(productionJobSettled({...j,response:{success:true}}),false);
 assert.equal(productionJobSettled({...j,response:{patient_communication:{iFileId:42},externalExecution:'uncertain'}}),false);
});
for(const type of Object.keys(PERIO_READ_FIELDS) as (keyof typeof PERIO_READ_FIELDS)[])for(const status of ['pending','processing','completed','failed'])test(`${type} ${status} exact read contract`,()=>{
 const j:ReadJob={id:'read',status,job_type:type,request:{method:'POST',path:'/php/forms/db_getFormData.php',contentType:'json',body:[{fields:PERIO_READ_FIELDS[type],parameters:[{practice_id:1181,...(type==='periodontal_chart_perio_exams'?{perioexam_id:42}:{patient_id:123})}]}]},response:{},locked_by:'retained'};
 assert.equal(productionJobSettled({...j,response:{externalExecution:'uncertain'}}),false);
 assert.equal(productionJobClass(j),'read_only');assert.equal(productionJobSettled(j),['completed','failed'].includes(status));
 assert.equal(productionJobSettled({...j,request:{...j.request,path:'/php/forms/db_commitFormData.php'}}),false);
});
test('unknown future relevant type cannot settle even with terminal status',()=>assert.equal(productionJobSettled({id:'future',job_type:'periodontal_future_writer',status:'completed',response:{success:true}}),false));
test('missing MediRef helper with queue audit contradicts both absence and safe pre-insertion failure',()=>{
 const event={action:'Queued MediRef send',details:{jobId:'missing'}};
 assert.equal(productionExecutionSafe('draft',[],[]),true);assert.equal(productionExecutionSafe('draft',[],[event]),false);
 const p:ReadJob={id:'parent',job_type:'complete_report_workflow',status:'failed',response:{medirefPreparationFailure:{contract:'mediref-no-job-failure-v1',insertionOutcome:'not_attempted',externalExecution:'not_started',deadlineExceeded:false,stage:'pdf_generation',code:'MEDIREF_PDF_GENERATION_FAILED'}}};
 assert.equal(productionExecutionSafe('draft',[p],[]),true);assert.equal(productionExecutionSafe('draft',[p],[event]),false);
});
test('queue audit requires its exact same-draft settled send/preparation',()=>{
 const event={action:'Queued MediRef send',details:{jobId:'med'}};
 const j:ReadJob={id:'med',job_type:'send_mediref_letter',status:'completed',payload:{draftId:'draft'},result:{prepared:true,sent:false}};
 assert.equal(productionExecutionSafe('draft',[j],[event]),true);
 assert.equal(productionExecutionSafe('draft',[{...j,result:{sent:true}}],[event]),true);
 assert.equal(productionExecutionSafe('draft',[{...j,payload:{draftId:'other'}}],[event]),false);
 assert.equal(productionExecutionSafe('draft',[{...j,result:{prepared:true,sent:false,deadlineExceeded:true}}],[event]),false);
});
