"""Disposable PostgreSQL 17 synthetic tests; no app credentials or live connections.
Run: python3 scripts/manual-mediref-no-job-db.test.py
"""
import sys, pathlib, importlib.util, json, uuid, hashlib, unittest, concurrent.futures, time
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/historical-reconciliation-db.test.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

def sql(q,ok=True): return b.sql(q,ok)
def rpc(q): return json.loads(sql('set role service_role;'+q).splitlines()[-1])
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  b.Tests.setUpClass()
  sql('create schema auth;create table auth.users(id uuid primary key);')
  sql((ROOT/'supabase/migrations/20260916050207_manual_historical_mediref_verification.sql').read_text())
  cls.historical=sql("select jsonb_agg(pg_get_functiondef(oid) order by proname) from pg_proc where proname in ('inspect_manual_historical_mediref','verify_historical_mediref_completion');")
  sql(next((ROOT/'supabase/migrations').glob('*_manual_mediref_no_job_recovery.sql')).read_text())
 def setUp(self):
  self.d,self.actor,self.provider=[str(uuid.uuid4()) for _ in range(3)]
  self.parent=str(uuid.UUID(hashlib.md5(('praktika-complete-workflow:v1:'+self.d).encode()).hexdigest()))
  self.upload=str(uuid.UUID(hashlib.sha256(('praktika-continuation-child:v1\0'+self.parent+'\0upload_report_to_praktika').encode()).hexdigest()[:32]))
  self.stamp='2026-10-02T12:00:00Z'
  self.proof=dict(contract='mediref-no-job-failure-v1',insertionOutcome='not_attempted',externalExecution='not_started',deadlineExceeded=False,stage='pdf_generation',code='MEDIREF_PDF_GENERATION_FAILED')
  b.insert('report_drafts',dict(id=self.d,provider_id=self.provider,status='approved',patient_name='Synthetic Fixture',patient_dob='1980-01-01',report_type='SPT',edited_text='Synthetic approved letter only',provider_approved_at=self.stamp,created_at=self.stamp,updated_at=self.stamp,workflow_status='failed',workflow_mediref_status='failed',workflow_praktika_upload_status='completed',uploaded_to_praktika=True,workflow_icon_update_status='skipped',workflow_periodontal_chart_status='skipped',workflow_error='original automated failure',workflow_last_message='MediRef preparation needs reconciliation. No replacement job was created.'))
  b.insert('praktika_helper_jobs',dict(id=self.parent,app_user_id=self.actor,job_type='complete_report_workflow',status='failed',failed_at=self.stamp,error_message='original automated failure',attempts=1,created_at=self.stamp,updated_at=self.stamp,request=dict(reportDraftId=self.d,actorUserId=self.actor,options=dict(actor=dict(actorUserId=self.actor),attachPeriodontalChart=False)),response=dict(stage='upload',medirefPreparationFailure=self.proof)))
  b.insert('praktika_helper_jobs',dict(id=self.upload,app_user_id=self.actor,job_type='upload_report_to_praktika',status='completed',completed_at=self.stamp,attempts=1,created_at=self.stamp,updated_at=self.stamp,request=dict(reportDraftId=self.d,continuationId=self.parent),response=dict(patient_communication=dict(iFileId='42'))))
  sql(f"insert into user_status values('{self.actor}',true);insert into user_roles values('{self.actor}','typist');insert into providers values('{self.provider}',true);")
  self.preview=self.read();self.assertTrue(self.preview.get('eligible'),self.preview);self.token=self.preview['currentStateToken']
 def call(self,confirm=False,token=None,prior=None):
  return f"select verify_workflow_completion('{self.d}','mediref',{'null' if prior is None else chr(39)+prior+chr(39)},'{self.actor}',{str(confirm).lower()},{'null' if token is None else chr(39)+token+chr(39)});"
 def read(self):return rpc(self.call())
 def ack(self,token=None):return rpc(self.call(True,self.token if token is None else token))
 def parent_patch(self,value):sql(f"update praktika_helper_jobs set response=response || {b.literal(value)} where id='{self.parent}';")
 def draft_patch(self,changes):
  for k,v in changes.items():sql(f"update report_drafts set {k}={'null' if v is None else str(v).lower() if isinstance(v,bool) else chr(39)+str(v).replace(chr(39),chr(39)*2)+chr(39)} where id='{self.d}';")
 def job(self,status='pending',draft=None):
  j=str(uuid.uuid4());b.insert('mediref_helper_jobs',dict(id=j,job_type='send_mediref_letter',status=status,payload=dict(draftId=draft or self.d,workflowContinuationId=self.parent),attempts=1,created_at=self.stamp,updated_at=self.stamp));return j
 def enqueue_sql(self,status='pending',draft=None):return f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','{status}',{b.literal(dict(draftId=draft or self.d))});"
 def application_state(self):
  snapshot=sql(f"select jsonb_build_object('draft',to_jsonb(d),'parent',(select to_jsonb(j) from praktika_helper_jobs j where id='{self.parent}'),'uploads',(select jsonb_agg(to_jsonb(j)) from praktika_helper_jobs j where job_type='upload_report_to_praktika' and request->>'reportDraftId'='{self.d}')) from report_drafts d where id='{self.d}';")
  script="""const fs=require('fs');const {resolveWorkflow,shouldAppearInApproved}=require('./lib/report-writing/resolved-workflow.ts');const {continuationChildId}=require('./lib/report-writing/workflow-continuation-token.ts');const x=JSON.parse(fs.readFileSync(0,'utf8'));const r=resolveWorkflow(x.draft,{parent:x.parent,uploads:x.uploads||[],icons:[],mediref:[],currentUploadId:continuationChildId(x.parent.id,'upload_report_to_praktika'),currentIconId:continuationChildId(x.parent.id,'update_praktika_letter_icons'),livePraktikaActors:new Set(),liveMediref:false});console.log(JSON.stringify({status:r.status,branches:r.branches,approved:shouldAppearInApproved({...x.draft,workflow_resolved:r})}));"""
  result=b.cmd(['node','--import','tsx','-e',script],cwd=ROOT,input=snapshot);self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout)
 def test_eligible_preview_is_read_only_and_opaque(self):
  before=sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';");p=self.read();self.assertEqual(p['recoveryClass'],'no_prior_helper_job_v1');self.assertIsNone(p['priorJobId']);self.assertRegex(p['currentStateToken'],'^[0-9a-f]{64}$');self.assertNotIn('Synthetic',json.dumps(p));self.assertEqual(before,sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';"))
 def test_missing_proof_blocked(self):self.parent_patch({'medirefPreparationFailure':None});self.assertEqual(self.read()['code'],'missing_safe_evidence')
 def test_generic_text_is_not_proof(self):self.parent_patch({'medirefPreparationFailure':{},'error':'No replacement job was created.'});self.assertEqual(self.read()['code'],'missing_safe_evidence')
 def test_incomplete_or_uncertain_proof_blocked(self):
  for v in [dict(self.proof,insertionOutcome='unconfirmed'),dict(self.proof,externalExecution='uncertain'),dict(self.proof,deadlineExceeded=True),dict(self.proof,stage='helper_insertion'),dict(self.proof,code='OTHER'),dict(contract='mediref-no-job-failure-v1')]:self.parent_patch({'medirefPreparationFailure':v});self.assertEqual(self.read()['code'],'missing_safe_evidence')
 def test_pending_job_blocked(self):self.job();self.assertEqual(self.read()['code'],'active_work')
 def test_processing_job_blocked(self):self.job('processing');self.assertEqual(self.read()['code'],'active_work')
 def test_other_nonterminal_and_completed_jobs_blocked(self):
  for s in ['waiting','running','completed']:
   j=self.job(s);self.assertEqual(self.read()['code'],'active_work');sql(f"delete from mediref_helper_jobs where id='{j}';")
 def test_active_preparation_claim_blocked(self):self.draft_patch({'emailed_to_referrer_resend_id':'mediref:preparing:synthetic'});self.assertEqual(self.read()['code'],'uncertain_execution')
 def test_uncertain_execution_blocked(self):self.draft_patch({'emailed_to_referrer_at':self.stamp});self.assertEqual(self.read()['code'],'uncertain_execution')
 def test_parent_claim_and_runnable_retry_blocked(self):
  for patch in [{'dispatched':True},{'retryUploadId':str(uuid.uuid4())},{'issue':'uncertain'}]:
   self.parent_patch(patch);self.assertFalse(self.read()['ok']);self.parent_patch({k:None for k in patch})
  sql(f"update praktika_helper_jobs set locked_at=now(),locked_by='synthetic' where id='{self.parent}';");self.assertEqual(self.read()['code'],'active_work')
 def test_waiting_parent_not_no_job_recovery(self):sql(f"update praktika_helper_jobs set status='waiting' where id='{self.parent}';");self.assertEqual(self.read()['code'],'active_work')
 def test_stale_token_blocked(self):self.assertEqual(self.ack('0'*64)['code'],'state_changed')
 def test_changed_letter_blocked(self):self.draft_patch({'edited_text':'Changed synthetic letter'});self.assertEqual(self.ack()['code'],'state_changed')
 def test_changed_workflow_blocked(self):self.draft_patch({'workflow_icon_update_status':'pending'});self.assertEqual(self.ack()['code'],'state_changed')
 def test_idempotency_and_concurrent_confirmations(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:out=list(pool.map(lambda _:self.ack(),range(4)))
  self.assertTrue(all(x['ok'] for x in out),out);self.assertTrue(all(x['verification']==out[0]['verification'] for x in out));self.assertTrue(self.ack()['reconciled'])
 def test_acknowledgement_creates_no_job_and_keeps_failure_provenance(self):
  a=self.ack()['verification'];self.assertEqual(a['actorUserId'],self.actor);self.assertEqual(a['source'],'manually_sent');self.assertEqual(a['reason'],'operator_confirmed_exact_approved_letter_sent');self.assertRegex(a['letterFingerprint'],'^[0-9a-f]{64}$');self.assertEqual(a['previewFingerprint'],self.token);self.assertTrue(a['verifiedAt']);self.assertNotIn('Synthetic',json.dumps(a));self.assertEqual(a['originalFailure']['preparation'],self.proof)
  self.assertEqual(sql(f"select count(*) from mediref_helper_jobs where payload->>'draftId'='{self.d}';"),'0');self.assertEqual(sql(f"select workflow_error || ':' || coalesce(emailed_to_referrer_at::text,'null') from report_drafts where id='{self.d}';"),'original automated failure:null');self.assertEqual(sql(f"select error_message from praktika_helper_jobs where id='{self.parent}';"),'original automated failure')
 def test_target_remains_failed_preserving_other_raw_branches(self):
  self.draft_patch({'workflow_praktika_upload_status':'running','uploaded_to_praktika':False,'workflow_icon_update_status':'pending','workflow_periodontal_chart_status':'pending'});sql(f"update praktika_helper_jobs set request=jsonb_set(request,'{{options,attachPeriodontalChart}}','true') where id='{self.parent}';")
  self.token=self.read()['currentStateToken'];self.assertEqual(self.ack()['workflowStatus'],'failed');state=json.loads(sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';"));self.assertEqual(state['workflow_praktika_upload_status'],'running');self.assertEqual(state['workflow_icon_update_status'],'pending');self.assertEqual(state['workflow_periodontal_chart_status'],'pending');self.assertEqual(state['workflow_mediref_status'],'completed');self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';"),'failed');app=self.application_state();self.assertEqual(app['status'],'needs_attention');self.assertTrue(app['approved']);self.assertEqual(app['branches'],dict(praktika='completed',mediref='completed',icon='unknown',periodontal='unknown'))
 def test_fully_satisfied_parent_completes_without_dispatch(self):self.assertEqual(self.ack()['workflowStatus'],'completed');self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';"),'completed');app=self.application_state();self.assertEqual(app['status'],'completed');self.assertFalse(app['approved'])
 def test_insert_and_requeue_fenced(self):
  self.ack()
  for s in ['pending','processing','failed','completed']:sql(self.enqueue_sql(s),False)
 def test_stale_draft_preparation_claim_fenced(self):
  self.ack();sql(f"update report_drafts set workflow_mediref_status='pending',emailed_to_referrer_resend_id='mediref:preparing:synthetic' where id='{self.d}';",False)
 def test_marker_removal_replacement_delete_rebind_truncate_fenced(self):
  self.ack()
  for op in ["response='{}'", "response=jsonb_set(response,'{manualVerification,mediref,source}','\"automated\"')", "id=gen_random_uuid()", "job_type='other'", "request='{}'"]:
   sql(f"update praktika_helper_jobs set {op} where id='{self.parent}';",False)
  sql(f"delete from praktika_helper_jobs where id='{self.parent}';",False);sql('truncate praktika_helper_jobs;',False)
 def test_edit_does_not_clear_fence(self):self.ack();self.draft_patch({'edited_text':'Changed synthetic letter'});sql(self.enqueue_sql(),False);self.assertEqual(self.ack()['code'],'state_changed')
 def test_acknowledgement_first_enqueue_race(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(sql,'begin;'+self.call(True,self.token)+'select pg_sleep(.4);commit;');time.sleep(.15);sql(self.enqueue_sql(),False);a.result()
  self.assertTrue(self.read()['reconciled'])
 def test_enqueue_first_acknowledgement_race(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   j=pool.submit(sql,'begin;'+self.enqueue_sql()+'select pg_sleep(.4);commit;');time.sleep(.15);a=self.ack();j.result();self.assertFalse(a['ok']);self.assertEqual(a['code'],'active_work')
 def test_claim_first_acknowledgement_race(self):
  j=self.job()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,f"begin;update mediref_helper_jobs set status='processing',locked_by='synthetic',locked_at=now() where id='{j}';select pg_sleep(.4);commit;");time.sleep(.15);a=self.ack();f.result();self.assertEqual(a['code'],'active_work')
 def test_ack_first_claim_has_no_conflicting_row_and_revival_is_fenced(self):
  # No-job eligibility makes a prior same-draft row impossible. A stale claim
  # cannot fabricate one; even payload-rebinding from an unrelated row is fenced.
  other=str(uuid.uuid4());b.insert('report_drafts',dict(id=other,status='approved'));j=self.job('failed',other)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(sql,'begin;'+self.call(True,self.token)+'select pg_sleep(.4);commit;');time.sleep(.15)
   sql(f"update mediref_helper_jobs set status='processing',payload={b.literal(dict(draftId=self.d))} where id='{j}';",False);a.result()
  self.assertEqual(sql(f"select count(*) from mediref_helper_jobs where lower(payload->>'draftId')='{self.d}' and status='processing';"),'0')
 def test_legacy_failed_job_verification_unchanged(self):
  j=self.job('failed');before=sql(f"select to_jsonb(j) from mediref_helper_jobs j where id='{j}';");p=self.read();self.assertEqual(p['priorJobId'],j);self.assertNotIn('recoveryClass',p);a=rpc(self.call(True,prior=j));self.assertTrue(a['ok']);self.assertEqual(a['verification']['priorJobId'],j);self.assertNotIn('source',a['verification']);self.assertEqual(before,sql(f"select to_jsonb(j) from mediref_helper_jobs j where id='{j}';"))
 def test_historical_functions_unchanged(self):self.assertEqual(self.historical,sql("select jsonb_agg(pg_get_functiondef(oid) order by proname) from pg_proc where proname in ('inspect_manual_historical_mediref','verify_historical_mediref_completion');"))
 def test_authorization_and_provider_preserved(self):
  for role in ['anon','authenticated']:sql('set role '+role+';'+self.call(True,self.token),False)
  sql(f"update providers set is_active=false where id='{self.provider}';");self.assertEqual(self.ack()['code'],'not_authorized')
 def test_inactive_actor_denied(self):sql(f"update user_status set is_active=false where user_id='{self.actor}';");self.assertEqual(self.read()['code'],'not_authorized')
 def test_repeatable_snapshot_fails_closed(self):
  out=sql('begin isolation level repeatable read;'+self.call(True,self.token)+'rollback;');self.assertEqual(json.loads(out)['code'],'uncertain_execution');sql('begin isolation level repeatable read;'+self.enqueue_sql()+'commit;',False)
 def test_uppercase_draft_identity_fenced_and_detected(self):
  j=self.job(draft=self.d.upper());self.assertEqual(self.read()['code'],'active_work');sql(f"delete from mediref_helper_jobs where id='{j}';");self.ack();sql(self.enqueue_sql(draft=self.d.upper()),False)
 def test_rls_hidden_marker_fails_closed(self):
  self.ack();sql('alter table praktika_helper_jobs enable row level security;')
  try:sql('set role authenticated;'+self.enqueue_sql(),False)
  finally:sql('alter table praktika_helper_jobs disable row level security;')
 def test_retained_external_result_blocks_no_job_class(self):self.parent_patch({'medirefResult':{'sent':True}});self.assertEqual(self.read()['code'],'uncertain_execution')
 def test_retained_queued_send_audit_blocks_even_if_job_absent(self):b.insert('report_writing_audit_events',dict(id=str(uuid.uuid4()),entity_type='report_draft',entity_id=self.d,action='Queued MediRef send',details={},created_at=self.stamp));self.assertEqual(self.read()['code'],'uncertain_execution')
 def test_unapproved_null_draft_state_blocked(self):self.draft_patch({'status':None});self.assertEqual(self.read()['code'],'not_eligible')
 def test_null_parent_type_blocked(self):sql(f"update praktika_helper_jobs set job_type=null where id='{self.parent}';");self.assertEqual(self.read()['code'],'not_eligible')
 def test_null_parent_status_blocked(self):sql(f"update praktika_helper_jobs set status=null where id='{self.parent}';");self.assertEqual(self.read()['code'],'active_work')
 def test_noncanonical_upload_does_not_complete_parent(self):sql(f"update praktika_helper_jobs set id=gen_random_uuid() where id='{self.upload}';");self.token=self.read()['currentStateToken'];self.assertEqual(self.ack()['workflowStatus'],'failed')
 def test_foreign_upload_actor_does_not_complete_parent(self):sql(f"update praktika_helper_jobs set app_user_id=gen_random_uuid() where id='{self.upload}';");self.token=self.read()['currentStateToken'];self.assertEqual(self.ack()['workflowStatus'],'failed')
 def test_parentless_uses_historical_review(self):sql(f"delete from praktika_helper_jobs where id='{self.parent}';");self.assertEqual(self.read()['code'],'historical_review_required')

if __name__=='__main__':
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert r.returncode==0,r.stderr
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert r.returncode==0,r.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
