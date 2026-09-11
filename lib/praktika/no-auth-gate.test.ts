import assert from 'node:assert/strict';
import {test} from 'node:test';
import {derivePraktikaConnection, praktikaNoAuthGateEnabled} from './authentication';
import {praktikaJobEligibility} from './job-eligibility';
import {createPraktikaAuthenticationGate, validateGstResponse} from './authentication-probe';
import {currentStatus, connectionExpiry} from './use-status-expiry';
const user='11111111-1111-4111-8111-111111111111';
const row=()=>({status:'connected',app_user_id:user,helper_instance_id:'owner',helper_heartbeat_at:new Date().toISOString(),authenticated_at:null});
async function scoped(run:()=>void|Promise<void>){
 const old=process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE, scope=process.env.PRAKTIKA_EXPERIMENT_USER_ID;
 process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE='true'; process.env.PRAKTIKA_EXPERIMENT_USER_ID=user;
 try{await run();}finally{if(old===undefined)delete process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE;else process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE=old;if(scope===undefined)delete process.env.PRAKTIKA_EXPERIMENT_USER_ID;else process.env.PRAKTIKA_EXPERIMENT_USER_ID=scope;}
}
for(const proof of [null,new Date(0).toISOString()])test('missing/stale proof and experimental evidence cannot gate scoped jobs',()=>scoped(()=>{
 const r={...row(),authenticated_at:proof,experimental_auth_status:'ineligible',experimental_auth_at:new Date(0).toISOString(),experimental_helper_instance_id:'old'};
 for(const job of ['patient_match_search','upload_report_to_praktika','update_praktika_letter_icons'])assert.equal(praktikaJobEligibility(r,job,{}).eligible,true);
 assert.equal(derivePraktikaConnection(r).authenticationVerified,false);
}));
for(const status of ['waiting_for_credentials','waiting_for_mfa','login_required','expired','error','not_started'])test(status+' blocks scoped jobs',()=>scoped(()=>{
 assert.equal(praktikaJobEligibility({...row(),status},'upload_report_to_praktika',{}).eligible,false);
}));
for(const patch of [{app_user_id:'other'},{helper_instance_id:null},{helper_heartbeat_at:new Date(0).toISOString()},{current_url:'https://praktika.praktika.net.au/v2/login'}])test('scope/lease/login guard remains enforced',()=>scoped(()=>{
 assert.equal(praktikaJobEligibility({...row(),...patch},'patient_match_search',{}).eligible,false);
}));
for(const scope of ['', 'invalid'])test('missing/invalid scope cannot enable globally',()=>scoped(()=>{
 process.env.PRAKTIKA_EXPERIMENT_USER_ID=scope;assert.equal(praktikaNoAuthGateEnabled(row()),false);
 assert.equal(derivePraktikaConnection(row()).connected,false);
}));
test('flag disabled restores prior gating',()=>scoped(()=>{
 assert.equal(derivePraktikaConnection(row()).connected,true);process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE='false';assert.equal(derivePraktikaConnection(row()).connected,false);
}));
test('explicit helper check does not wait for a pending GST renewal or manufacture proof',()=>scoped(async()=>{
 const r=row(); let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});let probes=0;
 const gate=createPraktikaAuthenticationGate({readOwnedSession:async()=>r,assertOwned:async()=>{},probe:async()=>{probes++;await delayed;return validateGstResponse(307,true,'');},recordSuccess:async()=>assert.fail('no strict success'),recordFailure:async()=>{}});
 const renewal=gate.renew();const rejected=assert.rejects(renewal);await new Promise(resolve=>setImmediate(resolve));
 try {await gate();assert.equal(r.authenticated_at,null);assert.equal(probes,1);}finally{release();await rejected;}
}));
test('UI availability expires by heartbeat without auth evidence',()=>{
 const now=Date.now(),r={status:'connected',connected:true,helperAlive:true,helperHeartbeatAt:new Date(now).toISOString(),operationalWithoutAuth:true};
 assert.equal(currentStatus(r,now),'connected');assert.equal(connectionExpiry(r,now),now+90000);assert.equal(currentStatus(r,now+90000),'not_started');
});

for(const path of ['/v2/logout','/logout','/v2/login/'])test('known logout/login page blocks scoped mode '+path,()=>scoped(()=>{
 assert.equal(derivePraktikaConnection({...row(),current_url:'https://praktika.praktika.net.au'+path}).connected,false);
}));
