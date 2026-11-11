"""Disposable local PostgreSQL, synthetic fixtures; no app credentials or TCP."""
import sys,pathlib,importlib.util,json,uuid,hashlib,unittest,concurrent.futures,subprocess
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('existing_resolution',ROOT/'scripts/workflow-resolution-db.test.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
b=f.b;sql=f.sql;rpc=f.rpc
MIGRATION=ROOT/'supabase/migrations/20261111021821_letters_icon_manual_completion.sql'
PERFORMANCE=next((ROOT/'supabase/migrations').glob('*_manual_icon_eligibility_performance.sql'))
class ManualIconTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  f.Tests.setUpClass()
  sql('create table report_letter_queue(id uuid primary key,report_draft_id uuid,appointment_id text,praktika_patient_id text);grant select on report_letter_queue to service_role;')
  definitions=sql("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and proname in ('workflow_resolution_snapshot','workflow_resolution_projection','workflow_resolution_fenced','workflow_resolution_legacy_execution_safe');")
  (b.CLUSTER/'definition-hashes.json').write_text(definitions)
  before=sql("select jsonb_build_array((select count(*) from report_drafts),(select count(*) from praktika_helper_jobs),(select count(*) from report_writing_audit_events));")
  # Repeat application is supported; neither application changes existing data.
  sql(MIGRATION.read_text());sql(MIGRATION.read_text())
  (b.CLUSTER/'eligibility-pre-fix-definitions.json').write_text(sql("select jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) from pg_proc where pronamespace='public'::regnamespace and proname in ('workflow_resolution_snapshot','workflow_resolution_legacy_draft_safe','manual_letter_icon_closed','workflow_resolution_job_associated');"))
  sql(PERFORMANCE.read_text());sql(PERFORMANCE.read_text())
  assert before==sql("select jsonb_build_array((select count(*) from report_drafts),(select count(*) from praktika_helper_jobs),(select count(*) from report_writing_audit_events));")
 def snapshot(self):return f.Tests.snapshot(self)
 def setUp(self):
  f.Tests.setUp(self)
  def child(kind):return str(uuid.UUID(hashlib.sha256(b'praktika-continuation-child:v1\0'+self.parent.encode()+b'\0'+kind.encode()).hexdigest()[:32]))
  self.icon,self.upload,self.med=child('update_praktika_letter_icons'),child('upload_report_to_praktika'),str(uuid.uuid4())
  stamp='2026-11-11T00:00:00Z'
  sql(f"update praktika_helper_jobs set response='{{\"stage\":\"icon\"}}' where id='{self.parent}';update report_drafts set workflow_praktika_upload_status='completed',workflow_icon_update_status='failed',workflow_mediref_status='completed',workflow_last_message='Original synthetic message' where id='{self.d}';")
  b.insert('praktika_helper_jobs',dict(id=self.upload,app_user_id=self.actor,job_type='upload_report_to_praktika',status='completed',completed_at=stamp,request=dict(reportDraftId=self.d,continuationId=self.parent),response=dict(patient_communication=dict(iFileId=42))))
  b.insert('praktika_helper_jobs',dict(id=self.icon,app_user_id=self.actor,job_type='update_praktika_letter_icons',status='failed',failed_at=stamp,request=dict(reportDraftId=self.d,continuationId=self.parent,method='POST',path='/php/forms/db_commitFormData.php',contentType='json',body=[dict(request_id='synthetic',practice_id=1181,appointment_id=456,appointment_icon1id=6597,appointment_icon2id=0,appointment_icon3id=0,appointment_icon4id=0)]),error_message='Praktika write outcome is unconfirmed. Reconcile before retrying.'))
  b.insert('mediref_helper_jobs',dict(id=self.med,job_type='send_mediref_letter',status='completed',payload=dict(draftId=self.d,workflowContinuationId=self.parent),result=dict(prepared=True,sent=False)))
  b.insert('report_letter_queue',dict(id=str(uuid.uuid4()),report_draft_id=self.d,appointment_id='456',praktika_patient_id='123'))
  self.s=self.preview()
 def preview(self):return rpc(f"select inspect_manual_letter_icon('{self.d}','{self.actor}');")
 def call(self,confirmed='true'):
  return f"select confirm_manual_letter_icon('{self.d}','{self.actor}','{self.s['fingerprint']}','{self.s['letterFingerprint']}',{confirmed});"
 def confirm(self):return rpc(self.call())
 def jobs(self):return sql(f"select jsonb_build_object('praktika',(select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j where request->>'reportDraftId'='{self.d}'),'mediref',(select jsonb_agg(to_jsonb(j) order by id) from mediref_helper_jobs j where payload->>'draftId'='{self.d}'));")
 def test_complete_preserves_all_jobs_clinical_content_and_original_evidence(self):
  self.assertTrue(self.s['manualIconReady']);before=self.jobs()
  sql(f"insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft','{self.d}','Original synthetic audit','{{\"preserved\":true}}');")
  self.s=self.preview();original=json.loads(sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';"))
  self.assertTrue(self.confirm()['ok']);self.assertEqual(before,self.jobs())
  after=json.loads(sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';"))
  for key,value in original.items():
   if key not in ['workflow_status','updated_at']:self.assertEqual(value,after[key],key)
  self.assertEqual(after['workflow_status'],'completed');self.assertEqual(after['status'],'approved')
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='Original synthetic audit';"),'1')
  projection=rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")
  self.assertTrue(projection['executionSafe']);self.assertEqual(len(projection['events']),2)
  event=next(e for e in projection['events'] if e['action']=='workflow_resolution_completed')['details']
  self.assertEqual(event['actorUserId'],self.actor);self.assertTrue(event['iconManuallyVerified']);self.assertTrue(event['completedAt']);self.assertNotIn('Synthetic',json.dumps(event))
 def test_current_typescript_projection_moves_manual_closure_from_approved_to_history(self):
  original=self.preview();self.assertTrue(self.confirm()['ok'])
  projection=rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")
  code="""
const fs=require('node:fs'),assert=require('node:assert/strict');
const {resolveWorkflow}=require('./lib/report-writing/resolved-workflow.ts');
const {partitionApprovedForVerification}=require('./lib/report-writing/typist-approved-partition.ts');
const {toDraftListItem}=require('./lib/report-writing/draft-contract.ts');
const {continuationChildId}=require('./lib/report-writing/workflow-continuation-token.ts');
const {s,p}=JSON.parse(fs.readFileSync(0,'utf8'));const e={parent:s.parent,uploads:s.praktika.filter(j=>j.job_type==='upload_report_to_praktika'),icons:s.praktika.filter(j=>j.job_type==='update_praktika_letter_icons'),mediref:s.mediref,currentUploadId:continuationChildId(s.parent.id,'upload_report_to_praktika'),currentIconId:continuationChildId(s.parent.id,'update_praktika_letter_icons'),livePraktikaActors:new Set(),liveMediref:false};
const before=toDraftListItem({...s.draft,workflow_resolved:resolveWorkflow(s.draft,e),workflow_continuation_context:'present'},true);
assert.equal(before.workflow_resolved.branches.icon,'failed');assert.equal(partitionApprovedForVerification([before]).approved.length,1);
const after=toDraftListItem({...s.draft,workflow_resolved:resolveWorkflow(s.draft,{...e,resolution:p}),workflow_continuation_context:'present'},true);
assert.equal(after.workflow_resolved.status,'completed');assert.equal(after.workflow_resolved.operatorCompletion.source,'operator_manual_completion');
assert.equal(after.workflow_resolved.branches.icon,'completed');assert.equal(after.status,'approved');assert.equal(after.provider_approved_at,before.provider_approved_at);
assert.deepEqual(partitionApprovedForVerification([after]),{approved:[],verificationItems:[]});
assert.equal(s.praktika.find(j=>j.job_type==='update_praktika_letter_icons').status,'failed');
"""
  result=subprocess.run(['node','--import','tsx','-e',code],cwd=ROOT,input=json.dumps(dict(s=original,p=projection)),capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
 def test_repeat_migration_preserves_an_existing_manual_completion(self):
  self.assertTrue(self.confirm()['ok']);before=self.jobs()
  events=sql(f"select jsonb_agg(to_jsonb(a) order by id) from report_writing_audit_events a where entity_id='{self.d}';")
  sql(MIGRATION.read_text());sql(PERFORMANCE.read_text())
  self.assertEqual(before,self.jobs());self.assertEqual(events,sql(f"select jsonb_agg(to_jsonb(a) order by id) from report_writing_audit_events a where entity_id='{self.d}';"))
  self.assertTrue(rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")['executionSafe'])
  self.assertTrue(self.confirm()['reconciled'])
 def test_active_parent_and_child_states_reject(self):
  for table,job,restore in [('praktika_helper_jobs',self.parent,'failed'),('praktika_helper_jobs',self.icon,'failed'),('praktika_helper_jobs',self.upload,'completed'),('mediref_helper_jobs',self.med,'completed')]:
   for status in ['pending','processing']:
    with self.subTest(table=table,status=status):
     sql(f"update {table} set status='{status}' where id='{job}';")
     self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
     sql(f"update {table} set status='{restore}' where id='{job}';")
 def test_candidate_discovery_matches_original_authority_for_scoped_conflicts_and_paths(self):
  other=str(uuid.uuid4());b.insert('report_drafts',{**self.s['draft'],'id':other})
  for kind,request in [('synthetic_unknown',dict(reportDraftId=self.d.upper())),('synthetic_unknown',dict(reportDraftId=other,continuationId=self.parent)),('upload_report_to_praktika',dict(body=dict(file=dict(path=f'report-uploads/synthetic/{self.d}/letter.pdf')))),('upload_report_to_praktika',dict(body=dict(file=dict(path=f'wrong-root/synthetic/{self.d}/letter.pdf')))),('synthetic_unknown',{})]:
   b.insert('praktika_helper_jobs',dict(id=str(uuid.uuid4()),job_type=kind,status='failed',request=request))
  self.assertEqual(sql(f"select count(*) from ((select id from workflow_resolution_associated_jobs('{self.d}') except select id from praktika_helper_jobs j where workflow_resolution_job_associated(to_jsonb(j),'{self.d}')) union all (select id from praktika_helper_jobs j where workflow_resolution_job_associated(to_jsonb(j),'{self.d}') except select id from workflow_resolution_associated_jobs('{self.d}'))) differences;"),'0')
  self.assertFalse(self.preview()['manualIconReady'])
 def test_missing_draft_candidate_discovery_agrees_with_original_empty_set(self):
  missing=str(uuid.uuid4())
  self.assertEqual(sql(f"select count(*) from workflow_resolution_associated_jobs('{missing}');"),'0')
  self.assertEqual(sql(f"select count(*) from praktika_helper_jobs j where workflow_resolution_job_associated(to_jsonb(j),'{missing}');"),'0')
 def test_z_large_unrelated_helper_history_keeps_real_snapshot_inside_five_seconds(self):
  for start in range(1,106001,500):
   sql(f"insert into praktika_helper_jobs(id,job_type,status,request,response) select md5('synthetic-perf-'||i)::uuid,'synthetic_unrelated','completed',jsonb_build_object('unrelated',i),jsonb_build_object('padding',repeat('synthetic',256)) from generate_series({start},{start+499}) i;")
  try:
   checked=sql('begin;set local role service_role;set local statement_timeout=5000;'+f"select inspect_manual_letter_icon('{self.d}','{self.actor}');"+'commit;')
   snapshot=json.loads(checked.splitlines()[-1]);self.assertTrue(snapshot['manualIconReady']);self.assertEqual(len(snapshot['praktika']),3)
  finally:
   for start in range(1,106001,500):sql(f"delete from praktika_helper_jobs where id in (select md5('synthetic-perf-'||i)::uuid from generate_series({start},{start+499}) i);")
 def test_retained_completed_upload_lease_uses_existing_terminal_proof(self):
  sql(f"update praktika_helper_jobs set locked_at=now(),locked_by='synthetic-retained-owner' where id='{self.upload}';")
  self.s=self.preview();self.assertTrue(self.s['manualIconReady']);before=self.jobs()
  self.assertTrue(self.confirm()['ok']);self.assertEqual(before,self.jobs())
  self.assertTrue(rpc(f"select to_jsonb(p) from workflow_resolution_projection(array['{self.d}'::uuid]) p;")['executionSafe'])
 def test_retained_upload_lock_never_overrides_active_or_uncertain_results(self):
  for changes in ["status='processing'","response='{}'","response="+b.literal(dict(patient_communication=dict(iFileId=42),externalExecution='uncertain'))]:
   with self.subTest(changes=changes):
    sql(f"update praktika_helper_jobs set locked_at=now(),locked_by='synthetic-owner',{changes} where id='{self.upload}';")
    self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
    sql(f"update praktika_helper_jobs set status='completed',locked_at=null,locked_by=null,response='{{\"patient_communication\":{{\"iFileId\":42}}}}' where id='{self.upload}';")
 def test_missing_confirmation_writes_nothing(self):
  before=self.jobs()
  for v in ['false','null']:sql('set role service_role;'+self.call(v),False)
  self.assertEqual(before,self.jobs());self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}';"),'0')
 def test_concurrent_and_duplicate_completion_is_idempotent(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.confirm(),range(2)))
  self.assertTrue(all(v['ok'] for v in results));self.s=self.preview();self.assertTrue(self.confirm()['reconciled'])
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='workflow_resolution_completed';"),'1')
 def test_unresolved_non_icon_and_active_jobs_reject(self):
  for table,job,changes,restore in [('mediref_helper_jobs',self.med,"status='failed'","status='completed'"),('praktika_helper_jobs',self.upload,"status='failed'","status='completed'"),('praktika_helper_jobs',self.icon,"locked_by='synthetic-owner'","locked_by=null")]:
   sql(f"update {table} set {changes} where id='{job}';");self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok']);sql(f"update {table} set {restore} where id='{job}';")
 def test_wrong_appointment_and_unknown_requirements_reject(self):
  sql(f"update report_letter_queue set appointment_id='789' where report_draft_id='{self.d}';");self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
 def test_permissions_and_inactive_accounts(self):
  for role in ['anon','authenticated']:sql('set role '+role+';'+self.call(),False)
  sql(f"update user_status set is_active=false where user_id='{self.actor}';");sql('set role service_role;'+self.call(),False)
 def test_provider_cannot_admin_complete(self):
  sql(f"update user_roles set role='provider' where user_id='{self.actor}';");sql('set role service_role;'+self.call(),False)
 def test_stale_preview_cannot_complete(self):
  sql(f"update praktika_helper_jobs set updated_at=now() where id='{self.icon}';");self.assertFalse(self.confirm()['ok'])
 def test_closure_blocks_existing_recovery_enqueue_claim_and_reset(self):
  self.assertTrue(self.confirm()['ok'])
  for job in [self.parent,self.icon]:sql(f"update praktika_helper_jobs set status='pending' where id='{job}';",False)
  sql(f"insert into praktika_helper_jobs(job_type,status,request) values('update_praktika_letter_icons','pending',{b.literal(dict(reportDraftId=self.d))});",False)
  result=rpc(f"select begin_workflow_resolution_operation('{self.d}','icon','{uuid.uuid4()}');");self.assertFalse(result['ok'])
  sql(f"delete from report_writing_audit_events where entity_id='{self.d}';",False)
  sql(f"update report_writing_audit_events set details='{{}}' where entity_id='{self.d}';",False)
 def test_unrelated_execution_claim_blocks(self):
  rpc(f"select begin_workflow_resolution_operation('{self.d}','praktika','{uuid.uuid4()}');");self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
 def test_changed_approval_cannot_settle_old_preview(self):
  sql(f"update report_drafts set provider_approved_at=now() where id='{self.d}';");self.assertFalse(self.confirm()['ok'])
 def test_unsettled_mediref_queue_audit_blocks(self):
  sql(f"insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft','{self.d}','Queued MediRef send','{{}}');")
  self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
 def test_non_icon_chart_failure_blocks(self):
  sql(f"update report_drafts set workflow_periodontal_chart_status='failed',periodontal_chart_attachment_error='Synthetic chart failure' where id='{self.d}';")
  self.assertFalse(self.preview()['manualIconReady']);self.assertFalse(self.confirm()['ok'])
class ExistingResolutionTests(f.Tests):
 @classmethod
 def setUpClass(cls):pass

def load_tests(loader,tests,pattern):
 return unittest.TestSuite([loader.loadTestsFromTestCase(ManualIconTests),loader.loadTestsFromTestCase(ExistingResolutionTests)])
if __name__=='__main__':
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert r.returncode==0,r.stderr
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert r.returncode==0,r.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
