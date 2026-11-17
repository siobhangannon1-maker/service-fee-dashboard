"""Disposable PostgreSQL; synthetic fixtures only; no application credentials/TCP."""
import sys,pathlib,importlib.util,json,uuid,unittest,concurrent.futures,subprocess,threading,datetime
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('icon_fixture',ROOT/'scripts/letters-stabilisation-db.test.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
f=old.f;b=old.b;sql=old.sql;rpc=old.rpc
MIGRATION=next((ROOT/'supabase/migrations').glob('*_manual_workflow_administrative_completion.sql'))
STARTED=next((ROOT/'supabase/migrations').glob('*_manual_workflow_started_guard.sql'))
UNSETTLED=next((ROOT/'supabase/migrations').glob('*_manual_workflow_unsettled_mediref.sql'))
class AdministrativeCompletionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  old.ManualIconTests.setUpClass()
  before=sql("select jsonb_build_array((select count(*) from report_drafts),(select count(*) from praktika_helper_jobs),(select count(*) from report_writing_audit_events));")
  sql(MIGRATION.read_text());sql(MIGRATION.read_text());sql(STARTED.read_text());sql(STARTED.read_text());sql(UNSETTLED.read_text());sql(UNSETTLED.read_text())
  assert before==sql("select jsonb_build_array((select count(*) from report_drafts),(select count(*) from praktika_helper_jobs),(select count(*) from report_writing_audit_events));")
 def setUp(self):f.Tests.setUp(self)
 def snapshot(self):return rpc(f"select inspect_manual_workflow_completion('{self.d}','{self.actor}');")
 def call(self,confirmed='true'):
  return f"select confirm_manual_workflow_completion('{self.d}','{self.actor}','{self.s['fingerprint']}','{self.s['letterFingerprint']}',{confirmed});"
 def confirm(self):return rpc(self.call())
 def records(self):return sql(f"select jsonb_build_object('draft',(select to_jsonb(d) from report_drafts d where id='{self.d}'),'praktika',(select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j where request->>'reportDraftId'='{self.d}'),'mediref',(select jsonb_agg(to_jsonb(j) order by id) from mediref_helper_jobs j where payload->>'draftId'='{self.d}'));")
 def test_all_failed_or_unknown_automated_steps_can_be_administratively_resolved(self):
  sql(f"update report_drafts set workflow_periodontal_chart_status='pending',periodontal_chart_attachment_error='Synthetic chart unavailable',workflow_icon_update_status='failed' where id='{self.d}';")
  for kind in ['upload_report_to_praktika','update_praktika_letter_icons']:
   b.insert('praktika_helper_jobs',dict(id=str(uuid.uuid4()),job_type=kind,status='failed',failed_at=self.stamp,request=dict(reportDraftId=self.d),response=dict(externalExecution='uncertain'),error_message='Original synthetic external failure'))
  b.insert('mediref_helper_jobs',dict(id=str(uuid.uuid4()),job_type='send_mediref_letter',status='failed',payload=dict(draftId=self.d),error='Original synthetic send error',result={}))
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);before=json.loads(self.records());self.assertTrue(self.confirm()['ok']);after=json.loads(self.records())
  self.assertEqual(before['praktika'],after['praktika']);self.assertEqual(before['mediref'],after['mediref'])
  for key,value in before['draft'].items():
   if key not in ['workflow_status','updated_at']:self.assertEqual(value,after['draft'][key],key)
  self.assertEqual(after['draft']['status'],'approved');self.assertEqual(after['draft']['workflow_status'],'completed')
  events=json.loads(sql(f"select jsonb_agg(to_jsonb(a) order by created_at) from report_writing_audit_events a where entity_id='{self.d}' and action='workflow_resolution_completed';"))
  self.assertEqual(len(events),1);details=events[0]['details'];self.assertEqual(details['actorUserId'],self.actor);self.assertTrue(details['completedAt']);self.assertTrue(details['allRequiredStepsConfirmed']);self.assertEqual(details['completionType'],'administrative_override');self.assertIn('independently verified',details['reason']);self.assertNotIn('outcomes',details)
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_verification';"),'0')
 def test_clinical_approval_is_required_without_changing_any_decision(self):
  for status,stamp in [('awaiting_provider_approval',self.stamp),('draft',self.stamp),('approved',None)]:
   sql(f"update report_drafts set status='{status}',provider_approved_at={('null' if stamp is None else chr(39)+stamp+chr(39))} where id='{self.d}';")
   sql('set role service_role;'+self.call(),False)
 def test_explicit_confirmation_is_required(self):
  for value in ['false','null']:sql('set role service_role;'+self.call(value),False)
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"),'0')
 def test_no_automation_parent_or_artifact_is_required(self):
  sql(f"delete from praktika_helper_jobs where id='{self.parent}';update report_drafts set edited_text=null,ai_generated_text=null,source_text=null,workflow_status=null,workflow_started_at='2026-10-01T12:00:00Z' where id='{self.d}';")
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);self.assertTrue(self.confirm()['ok'])
 def test_never_started_rejects_direct_confirmation_without_mutation(self):
  sql(f"delete from praktika_helper_jobs where id='{self.parent}';update report_drafts set workflow_status=null,workflow_started_at=null,workflow_praktika_upload_status=null,workflow_mediref_status=null,workflow_icon_update_status=null,workflow_periodontal_chart_status=null where id='{self.d}';")
  before=self.records();self.s=self.snapshot();self.assertFalse(self.s['eligible']);self.assertEqual(self.s['reasonCode'],'workflow_not_started');self.assertFalse(self.confirm()['ok']);self.assertEqual(before,self.records())
 def test_raw_failed_flags_do_not_invent_workflow_start(self):
  sql(f"delete from praktika_helper_jobs where id='{self.parent}';update report_drafts set workflow_started_at=null where id='{self.d}';")
  self.s=self.snapshot();self.assertFalse(self.s['eligible']);self.assertEqual(self.s['reasonCode'],'workflow_not_started');self.assertFalse(self.confirm()['ok'])
 def test_stale_started_preview_cannot_bypass_locked_guard(self):
  sql(f"update report_drafts set workflow_started_at='{self.stamp}' where id='{self.d}';delete from praktika_helper_jobs where id='{self.parent}';")
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);sql(f"update report_drafts set workflow_started_at=null where id='{self.d}';")
  self.assertFalse(self.confirm()['ok'])
 def test_uploaded_partially_completed_letter_with_failed_job_stays_eligible(self):
  sql(f"update report_drafts set status='uploaded_to_praktika',workflow_praktika_upload_status='completed',workflow_icon_update_status='failed' where id='{self.d}';")
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);self.assertTrue(self.confirm()['ok'])
 def test_actor_permissions_and_inactive_account_are_enforced(self):
  for role in ['anon','authenticated']:sql('set role '+role+';'+self.call(),False)
  sql(f"update user_status set is_active=false where user_id='{self.actor}';");sql('set role service_role;'+self.call(),False)
  sql(f"update user_status set is_active=true where user_id='{self.actor}';update user_roles set role='provider_readonly' where user_id='{self.actor}';");sql('set role service_role;'+self.call(),False)
 def test_concurrent_and_duplicate_completion_has_one_audit_event(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.confirm(),range(2)))
  self.assertTrue(all(x['ok'] for x in results));self.assertTrue(self.confirm()['reconciled'])
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"),'1')
 def test_every_nonterminal_external_state_blocks(self):
  for table,kind in [('praktika_helper_jobs','upload_report_to_praktika'),('praktika_helper_jobs','complete_report_workflow'),('mediref_helper_jobs','send_mediref_letter')]:
   for status in ['pending','waiting','processing','running']:
    with self.subTest(table=table,status=status):
     job=str(uuid.uuid4());row=dict(id=job,job_type=kind,status=status)
     row.update(dict(payload=dict(draftId=self.d)) if table=='mediref_helper_jobs' else dict(request=dict(reportDraftId=self.d)))
     b.insert(table,row);value=self.snapshot();self.assertFalse(value['eligible']);self.assertEqual(value['reasonCode'],'active_job');self.assertFalse(self.confirm()['ok']);sql(f"update {table} set status='failed',locked_at=null,locked_by=null,updated_at=now() where id='{job}';")
 def test_unknown_inflight_operation_and_preparation_marker_block(self):
  permit=str(uuid.uuid4());rpc(f"select begin_workflow_resolution_operation('{self.d}','icon','{permit}');")
  self.assertEqual(self.snapshot()['reasonCode'],'active_operation');self.assertFalse(self.confirm()['ok'])
 def test_terminal_failed_job_permit_does_not_require_success(self):
  b.insert('report_writing_audit_events',dict(id=str(uuid.uuid4()),entity_type='report_draft',entity_id=self.d,action='workflow_resolution_execution',created_at='2026-10-01T11:59:00Z',details=dict(contract='workflow-resolution-v1',draftId=self.d,jobId=self.parent)))
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);self.assertTrue(self.confirm()['ok'])
 def test_lease_newer_than_failure_is_not_silently_ignored(self):
  sql(f"update praktika_helper_jobs set locked_at=now(),locked_by='synthetic-owner' where id='{self.parent}';")
  self.assertEqual(self.snapshot()['reasonCode'],'active_job');self.assertFalse(self.confirm()['ok'])
 def test_preparing_external_request_blocks_even_before_a_helper_is_created(self):
  sql(f"update report_drafts set emailed_to_referrer_resend_id='mediref:preparing:synthetic' where id='{self.d}';")
  self.assertEqual(self.snapshot()['reasonCode'],'active_preparation');self.assertFalse(self.confirm()['ok'])
 def test_old_terminal_failure_lock_does_not_require_a_successful_result(self):
  sql(f"update praktika_helper_jobs set locked_at='2026-10-01T11:59:00Z',locked_by='synthetic-retained-owner',response='{{\"externalExecution\":\"uncertain\"}}' where id='{self.parent}';")
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);before=self.records();self.assertTrue(self.confirm()['ok'])
  self.assertEqual(json.loads(before)['praktika'],json.loads(self.records())['praktika'])
 def request_record(self,minutes_old,branch='mediref'):
  permit=str(uuid.uuid4());created=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=minutes_old)).isoformat()
  b.insert('report_writing_audit_events',dict(id=permit,entity_type='report_draft',entity_id=self.d,action='workflow_resolution_execution',created_at=created,details=dict(contract='workflow-resolution-v1',version=1,draftId=self.d,branch=branch,permitId=permit,source='request_operation')))
  return permit
 def test_cancelled_job_counts_as_finished(self):
  b.insert('mediref_helper_jobs',dict(id=str(uuid.uuid4()),job_type='send_mediref_letter',status='cancelled',payload=dict(draftId=self.d),result={}))
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);self.assertTrue(self.confirm()['ok'])
 def test_cancelled_job_with_newer_lock_stays_blocked(self):
  b.insert('mediref_helper_jobs',dict(id=str(uuid.uuid4()),job_type='send_mediref_letter',status='cancelled',payload=dict(draftId=self.d),result={},updated_at='2026-10-01T11:00:00Z',locked_at='2026-10-01T12:00:00Z',locked_by='synthetic-owner'))
  self.assertEqual(self.snapshot()['reasonCode'],'active_job');self.assertFalse(self.confirm()['ok'])
 def test_old_mediref_request_without_job_is_completable_and_noted(self):
  permit=self.request_record(45)
  self.s=self.snapshot();self.assertTrue(self.s['eligible']);self.assertEqual(self.s['unsettledMedirefPermits'],[permit]);self.assertTrue(self.confirm()['ok'])
  details=json.loads(sql(f"select details from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"))
  self.assertTrue(details['unsettledMedirefStep']);self.assertEqual(details['unsettledMedirefPermitIds'],[permit])
  self.assertEqual(sql(f"select manual_workflow_completion_closed('{self.d}');"),'t')
 def test_recent_mediref_request_without_job_still_blocks(self):
  self.request_record(5);self.assertEqual(self.snapshot()['reasonCode'],'active_operation');self.assertFalse(self.confirm()['ok'])
 def test_mediref_request_record_blocks_when_a_mediref_job_exists(self):
  self.request_record(45);b.insert('mediref_helper_jobs',dict(id=str(uuid.uuid4()),job_type='send_mediref_letter',status='failed',payload=dict(draftId=self.d),result={}))
  self.assertEqual(self.snapshot()['reasonCode'],'active_operation');self.assertFalse(self.confirm()['ok'])
 def test_old_icon_request_without_job_still_blocks(self):
  self.request_record(45,'icon');self.assertEqual(self.snapshot()['reasonCode'],'active_operation');self.assertFalse(self.confirm()['ok'])
 def test_completion_without_unsettled_step_has_no_note(self):
  self.s=self.snapshot();self.assertEqual(self.s['unsettledMedirefPermits'],[]);self.assertTrue(self.confirm()['ok'])
  details=json.loads(sql(f"select details from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"))
  self.assertNotIn('unsettledMedirefStep',details)
 def test_stale_preview_and_changed_approval_reject(self):
  sql(f"update report_drafts set provider_approved_at=now() where id='{self.d}';");self.assertFalse(self.confirm()['ok'])
 def test_replay_and_audit_deletion_are_fenced(self):
  self.assertTrue(self.confirm()['ok']);sql(f"update praktika_helper_jobs set status='pending' where id='{self.parent}';",False)
  sql(f"insert into praktika_helper_jobs(job_type,status,request) values('update_praktika_letter_icons','pending',{b.literal(dict(reportDraftId=self.d))});",False)
  sql(f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending',{b.literal(dict(draftId=self.d))});",False)
  self.assertFalse(rpc(f"select begin_workflow_resolution_operation('{self.d}','mediref','{uuid.uuid4()}');")['ok'])
  sql(f"delete from report_writing_audit_events where entity_id='{self.d}';",False)
 def test_worker_claim_and_override_cannot_both_win(self):
  gate=threading.Barrier(2)
  def claim():
   gate.wait();return b.cmd([b.BIN/'psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=f"begin;update praktika_helper_jobs set status='processing',locked_at=now(),locked_by='synthetic-worker' where id='{self.parent}';select pg_sleep(0.2);commit;").returncode==0
  def close():gate.wait();return self.confirm()['ok']
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(claim);c=pool.submit(close);claimed,closed=a.result(),c.result()
  self.assertFalse(claimed and closed)
 def test_projection_preserves_failed_branch_outcomes_and_moves_to_history(self):
  before=self.records();self.assertTrue(self.confirm()['ok']);projection=rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")
  self.assertTrue(projection['executionSafe'])
  code="""const fs=require('node:fs'),assert=require('node:assert/strict');const {resolveWorkflow}=require('./lib/report-writing/resolved-workflow.ts');const {partitionApprovedForVerification}=require('./lib/report-writing/typist-approved-partition.ts');const {toDraftListItem}=require('./lib/report-writing/draft-contract.ts');const {s,p}=JSON.parse(fs.readFileSync(0,'utf8'));const d={...s.draft,workflow_resolved:resolveWorkflow(s.draft,{parent:s.praktika[0],uploads:[],icons:[],mediref:[],resolution:p,livePraktikaActors:new Set(),liveMediref:false})};assert.equal(d.status,'approved');assert.equal(d.workflow_resolved.status,'completed');assert.equal(d.workflow_resolved.operatorCompletion.source,'operator_manual_completion');assert.equal(d.workflow_resolved.branches.praktika,'unknown');assert.deepEqual(partitionApprovedForVerification([toDraftListItem(d,true)]),{approved:[],verificationItems:[],uncertaintyItems:[]});"""
  result=subprocess.run(['node','--import','tsx','-e',code],cwd=ROOT,input=json.dumps(dict(s=json.loads(before),p=projection)),capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
 def test_existing_icon_only_completion_remains_closed_and_is_not_duplicated(self):
  legacy=old.ManualIconTests('test_complete_preserves_all_jobs_clinical_content_and_original_evidence');legacy.setUp();self.assertTrue(legacy.confirm()['ok'])
  projection=rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{legacy.d}'::uuid]) p;");self.assertTrue(projection['executionSafe'])
  preview=rpc(f"select inspect_manual_workflow_completion('{legacy.d}','{legacy.actor}');");self.assertTrue(preview['alreadyResolved'])
  result=rpc(f"select confirm_manual_workflow_completion('{legacy.d}','{legacy.actor}','{preview['fingerprint']}','{preview['letterFingerprint']}',true);");self.assertTrue(result['reconciled'])
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{legacy.d}' and action='workflow_resolution_completed';"),'1')
 def test_migration_reapplication_keeps_completion_and_fences(self):
  self.assertTrue(self.confirm()['ok']);before=self.records();sql(STARTED.read_text());sql(UNSETTLED.read_text());self.assertEqual(before,self.records());self.assertTrue(self.confirm()['reconciled'])
class ExistingResolutionTests(f.Tests):
 @classmethod
 def setUpClass(cls):pass

def load_tests(loader,tests,pattern):
 return unittest.TestSuite([loader.loadTestsFromTestCase(AdministrativeCompletionTests),loader.loadTestsFromTestCase(ExistingResolutionTests)])

if __name__=='__main__':
 result=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert result.returncode==0,result.stderr
 result=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert result.returncode==0,result.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
