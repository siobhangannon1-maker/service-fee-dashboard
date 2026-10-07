"""Disposable PostgreSQL 17; synthetic fixtures; no application credentials/network."""
import sys,pathlib,importlib.util,json,uuid,hashlib,unittest,concurrent.futures,time,re
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/historical-reconciliation-db.test.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
def sql(q,ok=True):return b.sql(q,ok)
def rpc(q):return json.loads(sql('set role service_role;'+q).splitlines()[-1])
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  b.Tests.setUpClass()
  sql('create schema auth;create table auth.users(id uuid primary key);')
  sql((ROOT/'supabase/migrations/20260916050207_manual_historical_mediref_verification.sql').read_text())
  sql((ROOT/'supabase/migrations/20261003103536_manual_mediref_no_job_recovery.sql').read_text())
  edit_schema=re.search(r"cls.sql\('''(.*?)'''\)",(ROOT/'scripts/typist-edit-learning-db.test.py').read_text(),re.S).group(1)
  edit_schema=re.sub(r'create role .*?;|create table public.providers.*?;|create table public.report_drafts.*?;','',edit_schema,flags=re.S)
  sql('alter table providers add primary key(id);'+edit_schema)
  sql((ROOT/'supabase/migrations/20261003000000_typist_edit_learning_queue.sql').read_text())
  cls.learning=sql("select pg_get_functiondef('claim_typist_edit_learning(uuid)'::regprocedure);")
  cls.manual=sql("select pg_get_functiondef('verify_workflow_completion(uuid,text,uuid,uuid,boolean,text)'::regprocedure);")
  sql(next((ROOT/'supabase/migrations').glob('*_workflow_resolution.sql')).read_text())
  sql(next((ROOT/'supabase/migrations').glob('*_workflow_resolution_safety_correction.sql')).read_text())
  sql(next((ROOT/'supabase/migrations').glob('*_workflow_resolution_production_evidence.sql')).read_text())
  sql(next((ROOT/'supabase/migrations').glob('*_workflow_resolution_parity_correction.sql')).read_text())
 def setUp(self):
  self.d,self.actor,self.provider=[str(uuid.uuid4()) for _ in range(3)]
  self.parent=str(uuid.UUID(hashlib.md5(('praktika-complete-workflow:v1:'+self.d).encode()).hexdigest()))
  self.stamp='2026-10-01T12:00:00Z'
  b.insert('report_drafts',dict(id=self.d,provider_id=self.provider,status='approved',patient_name='Synthetic Fixture',edited_text='Synthetic approved letter',praktika_patient_id='123',provider_approved_at=self.stamp,created_at=self.stamp,updated_at=self.stamp,workflow_status='failed',workflow_praktika_upload_status='failed',workflow_icon_update_status='pending',workflow_mediref_status='failed',workflow_periodontal_chart_status='not_requested',workflow_error='Original synthetic failure'))
  self.options=dict(actor=dict(actorUserId=self.actor),attachPeriodontalChart=False,praktikaPatientId='123')
  self.proof=dict(contract='mediref-no-job-failure-v1',insertionOutcome='not_attempted',externalExecution='not_started',deadlineExceeded=False,stage='pdf_generation',code='MEDIREF_PDF_GENERATION_FAILED')
  b.insert('praktika_helper_jobs',dict(id=self.parent,app_user_id=self.actor,job_type='complete_report_workflow',status='failed',failed_at=self.stamp,error_message='Original synthetic failure',attempts=1,created_at=self.stamp,updated_at=self.stamp,request=dict(version=1,reportDraftId=self.d,actorUserId=self.actor,options=self.options),response=dict(stage='upload',medirefPreparationFailure=self.proof)))
  sql(f"insert into user_status values('{self.actor}',true);insert into user_roles values('{self.actor}','typist');insert into providers values('{self.provider}',true);")
  self.s=self.snapshot()
 def snapshot(self):
  value=rpc(f"select workflow_resolution_snapshot('{self.d}','{self.actor}');")
  projection=rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")
  self.assertEqual(value['executionSafe'],projection['executionSafe'])
  return value
 def call(self,outcomes=None,action='complete',plan=None,completed=None):
  outcomes=outcomes or dict(praktika='completed',icon='completed',mediref='completed')
  return f"select confirm_workflow_resolution('{self.d}','{self.actor}','{self.s['fingerprint']}','{self.s['letterFingerprint']}',{b.literal(outcomes)},{b.literal(['praktika','icon','mediref'])},'{action}',{b.literal(plan or [])},{b.literal(self.options)},{b.literal(completed or [])});"
 def confirm(self,**kw):return rpc(self.call(**kw))
 def enqueue(self,branch='praktika',status='pending'):
  event=sql(f"select coalesce(response#>>'{{resolution,eventId}}','') from praktika_helper_jobs where id='{self.parent}';")
  metadata=dict(resolutionEventId=event) if event else {}
  if branch=='mediref':return f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','{status}',{b.literal(dict(draftId=self.d,workflowContinuationId=self.parent,**metadata))});"
  return f"insert into praktika_helper_jobs(id,app_user_id,job_type,status,request) values(gen_random_uuid(),'{self.actor}','{'upload_report_to_praktika' if branch=='praktika' else 'update_praktika_letter_icons'}','{status}',{b.literal(dict(reportDraftId=self.d,continuationId=self.parent,**metadata))});"
 def test_unknown_completed_parent_and_locked_terminal_helpers_fail_closed(self):
  sql(f"update praktika_helper_jobs set status='completed',response='{{}}' where id='{self.parent}';")
  self.assertFalse(self.snapshot()['executionSafe'])
  sql(f"update praktika_helper_jobs set status='failed' where id='{self.parent}';")
  self.replace_response(dict(medirefPreparationFailure=self.proof))
  j=str(uuid.uuid4());b.insert('mediref_helper_jobs',dict(id=j,job_type='send_mediref_letter',status='completed',payload=dict(draftId=self.d),result=dict(prepared=True,sent=False),locked_by='uncertain-owner'))
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_000_unscoped_legacy_icon_uncertainty_fail_closed(self):
  for status,response in [('failed',{}),('completed',{}),('completed',{'success':True}),('completed',{'saved':True})]:
   with self.subTest(status=status,response=response):
    j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type='update_praktika_letter_icons',status=status,request=dict(body=[dict(appointment_id='unknown')]),response=response))
    self.assertTrue(self.snapshot()['executionSafe']) # unrelated unscoped evidence is unavailable for this target
    sql(f"delete from praktika_helper_jobs where id='{j}';")
 def replace_response(self,response):
  sql(f"update praktika_helper_jobs set response={b.literal(response)} where id='{self.parent}';")
 def test_nested_upload_execution_and_conflict_fail_closed(self):
  for value in [True,None,'false']:
   with self.subTest(value=value):
    self.replace_response(dict(medirefPreparationFailure=self.proof,uploadFailure=dict(requestInvoked=value,stage='preparation')))
    self.assertFalse(self.snapshot()['executionSafe'])
  self.replace_response(dict(medirefPreparationFailure=self.proof,requestInvoked=False,uploadFailure=dict(requestInvoked=True)))
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_missing_parent_legacy_execution_evidence_fail_closed(self):
  for response in [{},dict(stage='upload'),dict(dispatched=False),dict(medirefPreparationFailure={}),dict(medirefPreparationFailure={k:v for k,v in self.proof.items() if k!='externalExecution'})]:
   with self.subTest(response=response):
    self.replace_response(response);self.assertFalse(self.snapshot()['executionSafe']);self.assertFalse(self.confirm()['ok'])
 def test_invalid_parent_failure_contract_fail_closed(self):
  for key,value in [('contract','unknown'),('code','arbitrary'),('stage','send'),('deadlineExceeded',None),('insertionOutcome','unconfirmed'),('externalExecution','uncertain')]:
   with self.subTest(key=key):
    self.replace_response(dict(medirefPreparationFailure={**self.proof,key:value}));self.assertFalse(self.snapshot()['executionSafe'])
 def test_failed_upload_requires_nested_false_and_pre_execution_stage(self):
  for response,expected in [({},False),({'requestInvoked':False},False),({'uploadFailure':{'requestInvoked':False}},False),({'uploadFailure':{'requestInvoked':False,'stage':'response_read'}},False),({'uploadFailure':{'requestInvoked':False,'stage':'preparation'}},True),({'uploadFailure':{'requestInvoked':True,'stage':'preparation'}},False),({'externalExecution':'uncertain','uploadFailure':{'requestInvoked':False,'stage':'preparation'}},False)]:
   with self.subTest(response=response):
    j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type='upload_report_to_praktika',status='failed',request=dict(reportDraftId=self.d),response=response))
    self.assertEqual(self.snapshot()['executionSafe'],expected)
    sql(f"delete from praktika_helper_jobs where id='{j}';")
 def test_uncertain_legacy_icon_and_mediref_fail_closed(self):
  for kind,status,result in [('update_praktika_letter_icons','failed',{}),('update_praktika_letter_icons','completed',{}),('update_praktika_letter_icons','completed',{'success':True}),('send_mediref_letter','failed',{}),('send_mediref_letter','completed',{}),('send_mediref_letter','completed',{'prepared':True}),('send_mediref_letter','completed',{'prepared':True,'sent':False,'externalExecution':'uncertain'}),('send_mediref_letter','completed',{'sent':True,'error':'sensitive'})]:
   with self.subTest(kind=kind,status=status,result=result):
    j=str(uuid.uuid4());table='mediref_helper_jobs' if kind=='send_mediref_letter' else 'praktika_helper_jobs'
    b.insert(table,dict(id=j,job_type=kind,status=status,**(dict(payload=dict(draftId=self.d),result=result) if table=='mediref_helper_jobs' else dict(request=dict(reportDraftId=self.d),response=result))))
    self.assertFalse(self.snapshot()['executionSafe']);self.assertFalse(self.confirm()['ok']);sql(f"delete from {table} where id='{j}';")
 def test_privacy_allowlist_complete_and_resume(self):
  sensitive=dict(patientName='PRIVATE_PATIENT',letterText='PRIVATE_LETTER',email='PRIVATE_EMAIL',externalBody={'token':'PRIVATE_TOKEN'},rawError='PRIVATE_ERROR',credentials='PRIVATE_CREDENTIAL',unexpected={'deep':['PRIVATE_JSON']})
  for action in ['complete','resume']:
   with self.subTest(action=action):
    if action=='resume':self.setUp()
    self.replace_response(dict(stage='upload',medirefPreparationFailure={**self.proof,**sensitive},**sensitive))
    sql(f"update praktika_helper_jobs set error_message='PRIVATE_RAW_ERROR' where id='{self.parent}';update report_drafts set workflow_error='PRIVATE_WORKFLOW_ERROR' where id='{self.d}';")
    self.s=self.snapshot();self.assertTrue(self.s['executionSafe'])
    result=self.confirm(**(dict(action='resume',outcomes=dict(praktika='incomplete',icon='incomplete',mediref='incomplete'),plan=['praktika','icon','mediref']) if action=='resume' else {}));self.assertTrue(result['ok'])
    evidence=json.loads(sql(f"select details->'originalFailure' from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_{'completed' if action=='complete' else 'resume'}';"))
    self.assertEqual(set(evidence),{'contract','parentId','parentStatus','parentFailedAt','failureRecorded','workflowFailureRecorded'})
    self.assertNotIn('PRIVATE',json.dumps(evidence));self.assertTrue(evidence['failureRecorded']);self.assertTrue(evidence['workflowFailureRecorded'])
    self.assertIn('PRIVATE_PATIENT',sql(f"select response from praktika_helper_jobs where id='{self.parent}';"))
 def test_preview_read_only(self):
  before=sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}';");self.assertTrue(self.snapshot()['executionSafe']);self.assertEqual(before,sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}';"))
 def test_missing_helper_resume_creates_no_historical_job(self):
  o=dict(praktika='incomplete',icon='incomplete',mediref='incomplete');self.assertTrue(self.confirm(outcomes=o,action='resume',plan=list(o))['ok'])
  self.assertEqual(sql(f"select count(*) from praktika_helper_jobs where request->>'reportDraftId'='{self.d}';"),'1')
  self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';"),'waiting')
  sql(self.enqueue());self.assertEqual(sql(f"select count(*) from praktika_helper_jobs where request->>'reportDraftId'='{self.d}' and job_type='upload_report_to_praktika' and status='pending';"),'1')
  self.assertEqual(sql(f"select error_message from praktika_helper_jobs where id='{self.parent}';"),'Original synthetic failure')
  self.assertEqual(sql(f"select response->'manualVerification' from praktika_helper_jobs where id='{self.parent}';"),'')
 def test_terminal_completion_preserves_failures_and_raw_branch_fields(self):
  self.assertTrue(self.confirm()['ok']);self.assertEqual(sql(f"select workflow_error from report_drafts where id='{self.d}';"),'Original synthetic failure')
  self.assertEqual(sql(f"select workflow_praktika_upload_status from report_drafts where id='{self.d}';"),'failed')
  self.assertEqual(sql(f"select coalesce(emailed_to_referrer_at::text,'null') from report_drafts where id='{self.d}';"),'null')
  for branch in ['praktika','icon','mediref']:sql(self.enqueue(branch),False)
 def test_branch_completed_fence_survives_save(self):
  self.assertTrue(self.confirm(outcomes=dict(praktika='completed',icon='incomplete',mediref='incomplete'),action='save')['ok'])
  sql(self.enqueue(),False);sql(self.enqueue('icon'),False)
 def test_acknowledgement_idempotent(self):
  first=self.confirm();second=self.confirm();self.assertTrue(second['reconciled']);self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"),'1')
 def test_stale_preview_blocks(self):
  sql(f"update report_drafts set typist_queries='Synthetic change' where id='{self.d}';");self.assertFalse(self.confirm()['ok'])
 def test_active_missing_helper_blocks(self):sql(self.enqueue('icon'));self.assertFalse(self.snapshot()['executionSafe']);self.assertFalse(self.confirm()['ok'])
 def test_unsettled_request_blocks_after_timeout(self):
  permit=str(uuid.uuid4());rpc(f"select begin_workflow_resolution_operation('{self.d}','praktika','{permit}');")
  self.assertFalse(self.snapshot()['executionSafe']);self.assertFalse(self.confirm()['ok'])
  sql('set role service_role;'+f"select settle_workflow_resolution_operation('{self.d}','{permit}');");self.assertTrue(self.snapshot()['executionSafe'])
 def test_missing_helper_uncertainty_blocks(self):
  sql(f"update praktika_helper_jobs set response=jsonb_set(response,'{{medirefPreparationFailure,externalExecution}}','\"uncertain\"') where id='{self.parent}';");self.assertFalse(self.snapshot()['executionSafe'])
 def test_parentless_missing_legacy_evidence_blocks_completion_and_resume(self):
  sql(f"delete from praktika_helper_jobs where id='{self.parent}';");self.s=self.snapshot()
  self.assertFalse(self.s['executionSafe']);self.assertFalse(self.confirm()['ok'])
  o=dict(praktika='incomplete',icon='incomplete',mediref='incomplete')
  self.assertFalse(self.confirm(outcomes=o,action='resume',plan=list(o))['ok'])
  self.assertEqual(sql(f"select count(*) from praktika_helper_jobs where request->>'reportDraftId'='{self.d}';"),'0')
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}';"),'0')
 def test_late_mediref_preparation_preserves_failed_parent_message(self):
  j=str(uuid.uuid4());b.insert('mediref_helper_jobs',dict(id=j,job_type='send_mediref_letter',status='completed',payload=dict(draftId=self.d,workflowContinuationId=self.parent),result=dict(prepared=True,sent=False)))
  sql('set role service_role;'+f"select record_mediref_preparation_completion('{self.d}','{j}',{b.literal(dict(workflow_mediref_status='completed',workflow_error=None,workflow_last_message='MediRef prepared. Remaining workflow steps will continue automatically.',updated_at=self.stamp))});")
  self.assertEqual(sql(f"select workflow_status from report_drafts where id='{self.d}';"),'failed');self.assertEqual(sql(f"select workflow_error from report_drafts where id='{self.d}';"),'Original synthetic failure')
  self.assertNotIn('will continue automatically',sql(f"select workflow_last_message from report_drafts where id='{self.d}';"))
 def test_completion_first_insert_race(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(.4);commit;');time.sleep(.15);sql(self.enqueue(),False);future.result()
 def test_insert_first_completion_race(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.enqueue()+'select pg_sleep(.4);commit;');time.sleep(.15);result=self.confirm();future.result();self.assertFalse(result['ok'])
 def test_operation_first_completion_race(self):
  permit=str(uuid.uuid4())
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+f"select begin_workflow_resolution_operation('{self.d}','praktika','{permit}');select pg_sleep(.4);commit;");time.sleep(.15);self.assertFalse(self.confirm()['ok']);future.result()
 def test_complete_first_direct_mediref_permit_race(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(.4);commit;');time.sleep(.15);permit=str(uuid.uuid4());self.assertFalse(rpc(f"select begin_workflow_resolution_operation('{self.d}','mediref','{permit}');")['ok']);future.result()
 def test_no_role_can_call_confirmation(self):
  for role in ['anon','authenticated']:sql('set role '+role+';'+self.call(),False)
 def test_edit_learning_rpc_unchanged(self):self.assertEqual(self.learning,sql("select pg_get_functiondef('claim_typist_edit_learning(uuid)'::regprocedure);"))
 def test_existing_manual_mediref_rpc_only_factors_same_queue_check(self):
  expected=self.manual.replace("exists(select 1 from public.report_writing_audit_events where entity_type='report_draft'\n          and entity_id=p_draft_id::text and action='Queued MediRef send')","public.mediref_has_queued_send_audit(p_draft_id)")
  self.assertEqual(expected,sql("select pg_get_functiondef('verify_workflow_completion(uuid,text,uuid,uuid,boolean,text)'::regprocedure);"))
 def test_claim_settlement_requires_a_terminal_result(self):
  sql(self.enqueue(status='processing'))
  self.assertFalse(self.snapshot()['executionSafe'])
  job=sql(f"select id from praktika_helper_jobs where request->>'reportDraftId'='{self.d}' and job_type='upload_report_to_praktika';")
  sql(f"update praktika_helper_jobs set status='completed',response='{{\"patient_communication\":{{\"iFileId\":42}}}}' where id='{job}';")
  self.assertTrue(self.snapshot()['executionSafe'])
 def test_negative_verification_without_resume_blocks_late_insertion(self):
  self.confirm(outcomes=dict(praktika='incomplete',icon='incomplete',mediref='incomplete'),action='save')
  sql(self.enqueue(),False)
 def test_resume_rejects_stale_preparation_without_plan_reference(self):
  o=dict(praktika='incomplete',icon='incomplete',mediref='incomplete');self.confirm(outcomes=o,action='resume',plan=list(o))
  q=f"insert into praktika_helper_jobs(job_type,status,request) values('upload_report_to_praktika','pending',{b.literal(dict(reportDraftId=self.d,continuationId=self.parent))});"
  sql(q,False)
 def test_resumed_helpers_complete_only_with_real_results(self):
  self.run_resumed_completion(dict(prepared=True,sent=False))
 def test_resumed_mediref_missing_delivery_evidence_cannot_close(self):
  self.run_resumed_completion(dict(prepared=True),blocked=True)
 def test_privacy_controlled_resume_filters_historical_original_failure(self):
  self.run_resumed_completion(dict(prepared=True,sent=False),poison=True)
 def run_resumed_completion(self,med_result,blocked=False,poison=False):
  o=dict(praktika='incomplete',icon='incomplete',mediref='incomplete');self.confirm(outcomes=o,action='resume',plan=list(o))
  event=sql(f"select response#>>'{{resolution,eventId}}' from praktika_helper_jobs where id='{self.parent}';")
  if poison:
   # A historical resume record may predate the provenance allowlist.
   details=json.loads(sql(f"select details from report_writing_audit_events where id='{event}';"))
   details['originalFailure']=dict(parentStatus='PRIVATE_STATUS',patient='PRIVATE_PATIENT',email='PRIVATE_EMAIL',response={'token':'PRIVATE_TOKEN'},rawError='PRIVATE_ERROR')
   event=str(uuid.uuid4());b.insert('report_writing_audit_events',dict(id=event,entity_type='report_draft',entity_id=self.d,action='workflow_resolution_resume',details=details))
   sql(f"update praktika_helper_jobs set response=jsonb_set(response,'{{resolution,eventId}}',{b.literal(event)}) where id='{self.parent}';")
  sql(f"update praktika_helper_jobs set status='processing',locked_by='synthetic-owner',locked_at=now(),response=response || jsonb_build_object('dispatched',true) where id='{self.parent}';")
  for branch,jobtype,result in [('praktika','upload_report_to_praktika',dict(patient_communication=dict(iFileId=42))),('icon','update_praktika_letter_icons',dict(appointment_icon1id=6597,appointment_icon2id=0,appointment_icon3id=0,appointment_icon4id=0))]:
   child=str(uuid.UUID(hashlib.sha256(('praktika-continuation-child:v1\0'+self.parent+'\0'+jobtype).encode()).hexdigest()[:32]))
   b.insert('praktika_helper_jobs',dict(id=child,app_user_id=self.actor,job_type=jobtype,status='pending',request=dict(reportDraftId=self.d,continuationId=self.parent,resolutionEventId=event,**(dict(method='POST',path='/php/forms/db_commitFormData.php',contentType='json',body=[dict(practice_id=1181,appointment_id=456,**result)]) if branch=='icon' else {}))))
   sql(f"update praktika_helper_jobs set status='processing',locked_by='child-owner' where id='{child}';")
   sql(f"update praktika_helper_jobs set status='completed',response={b.literal(result)},locked_by=null where id='{child}';")
  job=str(uuid.uuid4());b.insert('mediref_helper_jobs',dict(id=job,job_type='send_mediref_letter',status='pending',payload=dict(draftId=self.d,workflowContinuationId=self.parent,resolutionEventId=event)))
  sql(f"update mediref_helper_jobs set status='processing',locked_by='med-owner' where id='{job}';")
  sql(f"update mediref_helper_jobs set status='completed',result={b.literal(med_result)},locked_by=null where id='{job}';")
  if blocked:
   sql(f"select complete_resolved_workflow('{self.d}','{self.parent}','synthetic-owner');",False)
   self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"),'0')
   return
  self.assertTrue(rpc(f"select complete_resolved_workflow('{self.d}','{self.parent}','synthetic-owner');")['ok'])
  self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';"),'completed')
  if poison:
   provenance=json.loads(sql(f"select details->'originalFailure' from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"))
   self.assertEqual(set(provenance),{'contract','parentId','parentStatus','parentFailedAt','failureRecorded','workflowFailureRecorded'})
   self.assertNotIn('PRIVATE',json.dumps(provenance));self.assertIsNone(provenance['parentStatus'])
  self.assertTrue(self.snapshot()['executionSafe'])
  for branch in ['praktika','icon','mediref']:sql(self.enqueue(branch),False)
 def prepare_manual_preview(self):
  sql(f"update report_drafts set workflow_last_message='MediRef preparation needs reconciliation. No replacement job was created.' where id='{self.d}';")
  self.s=self.snapshot()
  return rpc(f"select verify_workflow_completion('{self.d}','mediref',null,'{self.actor}',false,null);")
 def manual_call(self,token):return f"select verify_workflow_completion('{self.d}','mediref',null,'{self.actor}',true,'{token}');"
 def test_mark_manually_sent_first_stales_resolve_preview(self):
  preview=self.prepare_manual_preview();self.assertTrue(preview['eligible'])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.manual_call(preview['currentStateToken'])+'select pg_sleep(.4);commit;');time.sleep(.15)
   self.assertFalse(self.confirm()['ok']);future.result()
  sql(self.enqueue('mediref'),False)
 def test_resolve_first_rejects_concurrent_mark_manually_sent(self):
  preview=self.prepare_manual_preview();self.assertTrue(preview['eligible'])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(.4);commit;');time.sleep(.15)
   result=rpc(self.manual_call(preview['currentStateToken']));future.result();self.assertFalse(result['ok'])
 def test_claim_first_blocks_completion(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+f"update praktika_helper_jobs set status='processing',locked_by='synthetic-owner' where id='{self.parent}';select pg_sleep(.4);commit;");time.sleep(.15)
   self.assertFalse(self.confirm()['ok']);future.result()
 def test_completion_first_blocks_parent_claim(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(.4);commit;');time.sleep(.15)
   sql(f"update praktika_helper_jobs set status='processing',locked_by='synthetic-owner' where id='{self.parent}';",False);future.result()
 def test_changed_claim_owner_does_not_erase_old_uncertainty(self):
  sql(self.enqueue(status='processing'))
  job=sql(f"select id from praktika_helper_jobs where request->>'reportDraftId'='{self.d}' and job_type='upload_report_to_praktika';")
  sql(f"update praktika_helper_jobs set locked_by='new-owner' where id='{job}';")
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_execution';"),'2')
  sql(f"update praktika_helper_jobs set status='completed',response='{{\"patient_communication\":{{\"iFileId\":42}}}}' where id='{job}';")
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_actor_provider_and_letter_changes_rejected(self):
  sql(f"update providers set is_active=false where id='{self.provider}';");sql('set role service_role;'+self.call(),False)
 def test_evidence_delete_update_truncate_fenced(self):
  self.confirm()
  sql(f"delete from report_writing_audit_events where entity_id='{self.d}';",False);sql('truncate report_writing_audit_events;',False);sql('truncate praktika_helper_jobs;',False)
 def icon_request(self,**scope):
  return dict(method='POST',path='/php/forms/db_commitFormData.php',contentType='json',body=[dict(practice_id=1181,appointment_id=456,appointment_icon1id=6597,appointment_icon2id=0,appointment_icon3id=0,appointment_icon4id=0)],**scope)
 def icon_result(self):return dict(appointment_icon1id=6597,appointment_icon2id=0,appointment_icon3id=0,appointment_icon4id=0)
 def test_production_upload_and_icon_retained_locks_settle(self):
  for kind,response,request in [('upload_report_to_praktika',dict(patient_communication=dict(iFileId=42)),dict(reportDraftId=self.d)),('update_praktika_letter_icons',self.icon_result(),self.icon_request(reportDraftId=self.d))]:
   j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type=kind,status='completed',request=request,response=response,locked_by='retained-owner',locked_at=self.stamp))
   self.assertTrue(self.snapshot()['executionSafe'])
   sql(f"delete from praktika_helper_jobs where id='{j}';")
  request=self.icon_request();request['body'][0]['appointment_id']='9007199254740992'
  self.assertEqual(sql('select workflow_resolution_icon_success('+b.literal(self.icon_result())+','+b.literal(request)+');'),'f')
 def test_malformed_icon_and_uncertainty_override_retained_terminal_completion(self):
  for response in [dict(saved=True),dict(appointment_icon1id=6597),{**self.icon_result(),'appointment_icon4id':None},{**self.icon_result(),'externalExecution':'uncertain'},{**self.icon_result(),'appointment_icon2id':7360}]:
   j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type='update_praktika_letter_icons',status='completed',request=self.icon_request(reportDraftId=self.d),response=response,locked_by='retained-owner'))
   self.assertFalse(self.snapshot()['executionSafe']);sql(f"delete from praktika_helper_jobs where id='{j}';")
 def test_unscoped_exact_deterministic_child_is_relevant_even_when_uncertain(self):
  child=str(uuid.UUID(hashlib.sha256(('praktika-continuation-child:v1\0'+self.parent+'\0update_praktika_letter_icons').encode()).hexdigest()[:32]))
  b.insert('praktika_helper_jobs',dict(id=child,job_type='update_praktika_letter_icons',status='processing',request=self.icon_request(),locked_by='claimed'))
  self.assertFalse(self.snapshot()['executionSafe'])
  other=str(uuid.uuid4());self.assertEqual(sql(f"select workflow_resolution_job_associated(to_jsonb(j),'{other}') from praktika_helper_jobs j where id='{child}';"),'f')
 def test_unrelated_patient_legacy_icon_cannot_block_or_complete(self):
  unrelated=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=unrelated,job_type='update_praktika_letter_icons',status='failed',request=self.icon_request(),response={}))
  self.assertTrue(self.snapshot()['executionSafe']);self.assertEqual(self.snapshot()['praktika'][0]['id'],self.parent)
  self.assertEqual(sql(f"select workflow_resolution_job_associated(to_jsonb(j),'{self.d}') from praktika_helper_jobs j where id='{unrelated}';"),'f')
 def test_legacy_receipt_binding_is_exact_and_ambiguous_receipt_is_unavailable(self):
  upload=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=upload,app_user_id=self.actor,job_type='upload_report_to_praktika',status='completed',request=dict(reportDraftId=self.d),response=dict(patient_communication=dict(iFileId=42))))
  icon=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=icon,app_user_id=self.actor,job_type='update_praktika_letter_icons',status='completed',request=self.icon_request(),response=self.icon_result(),updated_at=self.stamp,locked_by='retained'))
  preview=b.literal(__import__('json').dumps(self.icon_result()))
  sql(f"update report_drafts set praktika_letter_icon_appointment_id='456',praktika_letter_icon_updated_at='{self.stamp}',praktika_letter_icon_update_response_preview={preview}#>>'{{}}' where id='{self.d}';")
  self.assertEqual(sql(f"select workflow_resolution_job_associated(to_jsonb(j),'{self.d}') from praktika_helper_jobs j where id='{icon}';"),'t')
  other=str(uuid.uuid4());b.insert('report_drafts',dict(id=other,praktika_letter_icon_appointment_id='456',praktika_letter_icon_updated_at=self.stamp,praktika_letter_icon_update_response_preview=__import__('json').dumps(dict(reversed(list(self.icon_result().items()))))))
  self.assertEqual(sql(f"select workflow_resolution_job_associated(to_jsonb(j),'{self.d}') from praktika_helper_jobs j where id='{icon}';"),'f')
 def test_supported_periodontal_reads_settle_without_proving_attachment(self):
  fields={'periodontal_chart_patient_perio_exam_ids':['patient_perioexamids','patient_medicalhistory','patient_images'],'periodontal_chart_perio_exams':['perioexam_id','perioexam_patientid','perioexam_providerid','perioexam_date','perioexam_notes','perioexam_diagnosis','perioexam_boneloss','perioexam_systemicfactors','perioexam_toothdata']}
  for kind,f in fields.items():
   for status in ['pending','processing','completed','failed']:
    request=dict(reportDraftId=self.d,method='POST',path='/php/forms/db_getFormData.php',contentType='json',body=[dict(fields=f,parameters=[dict(practice_id=1181,**({'patient_id':123} if kind.endswith('ids') else {'perioexam_id':42}))])])
    j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type=kind,status=status,request=request,response={},locked_by='retained'))
    self.assertEqual(self.snapshot()['executionSafe'],status in ('completed','failed'))
    sql(f"update praktika_helper_jobs set response='{{\"externalExecution\":\"uncertain\"}}' where id='{j}';")
    self.assertFalse(self.snapshot()['executionSafe'])
    self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_execution' and details->>'jobId'='{j}';"),'0')
    self.assertEqual(sql("select workflow_resolution_periodontal_read("+b.literal(dict(job_type=None,request=request))+");"),'f')
    sql(f"delete from praktika_helper_jobs where id='{j}';")
 def test_unknown_relevant_periodontal_generation_write_fails_closed(self):
  j=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=j,job_type='periodontal_future_generation',status='completed',request=dict(reportDraftId=self.d),response=dict(success=True)))
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_queue_audit_without_helper_blocks_even_safe_preinsertion_failure(self):
  b.insert('report_writing_audit_events',dict(id=str(uuid.uuid4()),entity_type='report_draft',entity_id=self.d,action='Queued MediRef send',details=dict(jobId=str(uuid.uuid4()))))
  self.assertFalse(self.snapshot()['executionSafe']);self.assertFalse(self.confirm()['ok'])
 def test_queue_audit_with_same_draft_settled_helper_is_not_contradictory(self):
  j=str(uuid.uuid4());b.insert('mediref_helper_jobs',dict(id=j,job_type='send_mediref_letter',status='completed',payload=dict(draftId=self.d),result=dict(prepared=True,sent=False)))
  b.insert('report_writing_audit_events',dict(id=str(uuid.uuid4()),entity_type='report_draft',entity_id=self.d,action='Queued MediRef send',details=dict(jobId=j)))
  self.assertTrue(self.snapshot()['executionSafe'])
  sql(f"update mediref_helper_jobs set result='{{\"sent\":true}}' where id='{j}';")
  self.assertTrue(self.snapshot()['executionSafe'])
  sql(f"update mediref_helper_jobs set result='{{\"sent\":true,\"externalExecution\":\"uncertain\"}}' where id='{j}';")
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_queue_audit_first_blocks_resolution_after_wait(self):
  event=str(uuid.uuid4())
  statement=f"insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values('{event}','report_draft','{self.d}','Queued MediRef send','{{}}');"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+statement+'select pg_sleep(.4);commit;');time.sleep(.15)
   result=self.confirm();future.result();self.assertFalse(result['ok'])
 def test_resolution_first_fences_late_queue_audit(self):
  event=str(uuid.uuid4())
  statement=f"insert into report_writing_audit_events(id,entity_type,entity_id,action,details) values('{event}','report_draft','{self.d}','Queued MediRef send','{{}}');"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(.4);commit;');time.sleep(.15)
   sql(statement,False);future.result()
 def test_explicit_draft_and_continuation_target_contradiction_blocks(self):
  other=str(uuid.uuid4());j=str(uuid.uuid4());b.insert('report_drafts',dict(id=other))
  b.insert('praktika_helper_jobs',dict(id=j,job_type='upload_report_to_praktika',status='completed',request=dict(reportDraftId=other,continuationId=self.parent),response=dict(patient_communication=dict(iFileId=42))))
  self.assertFalse(self.snapshot()['executionSafe'])
 def test_mediref_payload_and_parent_target_contradiction_blocks(self):
  other=str(uuid.uuid4());j=str(uuid.uuid4());b.insert('report_drafts',dict(id=other))
  b.insert('mediref_helper_jobs',dict(id=j,job_type='send_mediref_letter',status='completed',payload=dict(draftId=other,workflowContinuationId=self.parent),result=dict(prepared=True,sent=False)))
  self.assertFalse(self.snapshot()['executionSafe'])
if __name__=='__main__':
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert r.returncode==0,r.stderr
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert r.returncode==0,r.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
