import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivePraktikaConnection, PRAKTIKA_AUTH_FRESHNESS_MS, type PraktikaConnectionRow } from './authentication';
import { createPraktikaAuthenticationGate, validateGstResponse } from './authentication-probe';
import { currentStatus, connectionExpiry } from './use-status-expiry';
const user = '11111111-1111-4111-8111-111111111111';
function row(): PraktikaConnectionRow { return { status:'connected', app_user_id:user, helper_instance_id:'owner', helper_heartbeat_at:new Date().toISOString(), authenticated_at:null, experimental_auth_status:'eligible_307', experimental_auth_at:new Date().toISOString(), experimental_helper_instance_id:'owner' }; }
async function enabled(run:()=>void|Promise<void>, scope=user) {
 const flag=process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307, oldScope=process.env.PRAKTIKA_EXPERIMENT_USER_ID;
 process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307='true'; process.env.PRAKTIKA_EXPERIMENT_USER_ID=scope;
 try { await run(); } finally { if(flag===undefined) delete process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307; else process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307=flag; if(oldScope===undefined) delete process.env.PRAKTIKA_EXPERIMENT_USER_ID; else process.env.PRAKTIKA_EXPERIMENT_USER_ID=oldScope; }
}
test('scoped fresh generation evidence is available without strict proof; disabling restores strict behavior',()=>enabled(()=>{
 const r=row(); assert.equal(derivePraktikaConnection(r).experimentalEligible,true); assert.equal(derivePraktikaConnection(r).authenticationVerified,false);
 process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307='false'; assert.equal(derivePraktikaConnection(r).connected,false);
}));
for(const [name,patch] of Object.entries({stale:{experimental_auth_at:new Date(Date.now()-PRAKTIKA_AUTH_FRESHNESS_MS-1).toISOString()},future:{experimental_auth_at:new Date(Date.now()+60000).toISOString()},generation:{experimental_helper_instance_id:'old'},lease:{helper_heartbeat_at:new Date(Date.now()-91000).toISOString()},user:{app_user_id:'other'},credentials:{status:'waiting_for_credentials'},mfa:{status:'waiting_for_mfa'},login:{current_url:'https://praktika.praktika.net.au/v2/login'},missing:{experimental_auth_at:null}})) {
 test(name+' cannot authorize experimental work',()=>enabled(()=>{assert.equal(derivePraktikaConnection({...row(),...patch}).connected,false);}));
}
test('challenge overrides even fresh strict proof',()=>enabled(()=>{assert.equal(derivePraktikaConnection({...row(),status:'waiting_for_mfa',authenticated_at:new Date().toISOString()}).connected,false);}));
for(const status of [200,201,307,302,401,403,404,429,500]) test('probe '+status+' records separate evidence and never replays',()=>enabled(async()=>{
 const r=row(); r.experimental_auth_status=null; let calls=0, strict=0; const evidence:string[]=[];
 const gate=createPraktikaAuthenticationGate({helperToken:'safe-token',assertOwned:async()=>{},readOwnedSession:async()=>r,probe:async()=>{calls++;return validateGstResponse(status,true,'[]');},recordExperimental:async s=>{evidence.push(s);r.experimental_auth_status=s;},recordSuccess:async()=>{strict++;r.authenticated_at=new Date().toISOString();},recordFailure:async()=>{}});
 if(status===200||status===307) await gate(); else await assert.rejects(gate());
 assert.equal(calls,1); assert.equal(strict,status===200?1:0); assert.deepEqual(evidence,[status===307?'eligible_307':'ineligible']); if(status!==200) assert.equal(r.authenticated_at,null);
}));
test('old nullable row remains strict and later 200 restores proof',()=>enabled(async()=>{
 const r=row(); r.experimental_auth_status=null; r.experimental_auth_at=null; r.experimental_helper_instance_id=null;
 assert.equal(derivePraktikaConnection(r).connected,false); r.authenticated_at=new Date().toISOString(); assert.equal(derivePraktikaConnection(r).authenticationVerified,true);
}));
test('UI experimental availability expires at lease or evidence deadline',()=>{
 const now=Date.now(); const r={status:'connected',connected:true,helperAlive:true,helperHeartbeatAt:new Date(now).toISOString(),experimentalEligible:true,experimentalEligibilityExpiresAt:new Date(now+30000).toISOString()};
 assert.equal(connectionExpiry(r,now),now+30000); assert.equal(currentStatus(r,now),'connected'); assert.equal(currentStatus(r,now+30000),'checking_connection');
});

test('flag false 307 remains strict failure and makes no evidence write',()=>enabled(async()=>{
 process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307='false';
 const r=row(); const gate=createPraktikaAuthenticationGate({assertOwned:async()=>{},readOwnedSession:async()=>r,probe:async()=>validateGstResponse(307,true,''),recordExperimental:async()=>assert.fail('disabled'),recordSuccess:async()=>assert.fail('307'),recordFailure:async()=>{}});
 await assert.rejects(gate.renew());
}));
test('307 then 200: proof stays strict-only and experiment log contains only allowed fields',()=>enabled(async()=>{
 const r=row(); let status=307; const logs:unknown[][]=[]; const original=console.log;
 const gate=createPraktikaAuthenticationGate({helperToken:'safe-token',assertOwned:async()=>{},readOwnedSession:async()=>r,probe:async()=>validateGstResponse(status,true,'[]'),recordExperimental:async s=>{r.experimental_auth_status=s;},recordSuccess:async()=>{r.authenticated_at=new Date().toISOString();},recordFailure:async()=>{}});
 console.log=(...args)=>{logs.push(args);};
 try {await assert.rejects(gate.renew()); assert.equal(r.authenticated_at,null); status=200; await gate.renew(); assert.ok(r.authenticated_at);} finally {console.log=original;}
 const events=logs.filter(x=>x[0]==='[Praktika auth experiment] gst_200_307_eligibility');
 assert.equal(events.length,2);
 assert.deepEqual(events[0][1],{helperToken:'safe-token',httpStatus:307,strictAuthenticated:false,experimentalEligible:true,experimentEnabled:true});
}));
