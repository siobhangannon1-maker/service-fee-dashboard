import assert from 'node:assert/strict';
import {test} from 'node:test';
import {derivePraktikaConnection} from './authentication';
import {praktikaJobEligibility} from './job-eligibility';
const now=Date.now();
const row={status:'connected', app_user_id:'fixture', helper_instance_id:'owner', helper_heartbeat_at:new Date(now).toISOString()};
for(const jobType of ['patient_match_search','periodontal_chart_patient_perio_exam_ids','periodontal_chart_perio_exams','upload_report_to_praktika','update_praktika_letter_icons']) {
 test(jobType+' uses browser readiness, not proof or experiment evidence',()=>{
  for(const proof of [null,new Date(0).toISOString(),new Date(now).toISOString()])
   for(const evidence of ['eligible_307','ineligible','challenge',null]) {
    const input={...row,authenticated_at:proof,experimental_auth_status:evidence,experimental_auth_at:new Date(0).toISOString(),experimental_helper_instance_id:'old'};
    assert.equal(praktikaJobEligibility(input,jobType,{},now).eligible,true);
   }
 });
}
for(const status of ['refreshing','refresh_requested','waiting_for_credentials','waiting_for_mfa','error','expired','not_started']) test(status+' cannot dispatch',()=>{
 assert.equal(praktikaJobEligibility({...row,status},'upload_report_to_praktika',{},now).eligible,false);
});
for(const patch of [{helper_instance_id:null},{helper_heartbeat_at:new Date(0).toISOString()},{current_url:'https://praktika.praktika.net.au/v2/login'},{current_url:'https://praktika.praktika.net.au/v2/logout'}])test('ownership/liveness/challenge remains mandatory',()=>{
 assert.equal(derivePraktikaConnection({...row,...patch},now).connected,false);
});
test('deprecated experiment flags cannot change availability',()=>{
 const keys=['PRAKTIKA_EXPERIMENT_NO_AUTH_GATE','PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307','PRAKTIKA_EXPERIMENT_USER_ID'];
 const before=keys.map(k=>process.env[k]);
 try {for(const value of ['true','false','']){keys.forEach(k=>{process.env[k]=value;});assert.equal(derivePraktikaConnection(row,now).connected,true);}}
 finally {keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];});}
});
