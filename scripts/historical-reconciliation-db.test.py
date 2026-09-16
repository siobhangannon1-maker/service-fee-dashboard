"""Disposable PostgreSQL 17, synthetic data only. Never loads app credentials.
Run: python3 scripts/historical-reconciliation-db.test.py
"""
import os,pathlib,subprocess,tempfile,json,uuid,unittest,concurrent.futures,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=pathlib.Path('/opt/homebrew/opt/postgresql@17/bin')
CLUSTER=pathlib.Path(tempfile.mkdtemp(prefix='historical-reconciliation-',dir='/private/tmp'))
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG')}
ENV.update(PGHOST=str(CLUSTER),PGPORT='65438',PGUSER='postgres',PGDATABASE='postgres')
def cmd(args,**kw):return subprocess.run([str(x) for x in args],env=ENV,text=True,capture_output=True,**kw)
def sql(q,ok=True):
 r=cmd([BIN/'psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=q)
 if ok and r.returncode:raise AssertionError(r.stderr)
 if not ok:assert r.returncode,'Expected rejection'
 return r.stdout.strip()
def literal(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
def insert(table,row):sql(f'insert into {table} select * from jsonb_populate_record(null::{table},{literal(row)});')
MIGRATION=ROOT/'supabase/migrations/20260916013823_historical_workflow_reconciliation.sql'
SCHEMA="""
create role anon;create role authenticated;create role service_role bypassrls;
create schema extensions;create extension "uuid-ossp" schema extensions;
create table report_drafts(id uuid primary key,provider_id uuid,created_by uuid,patient_name text,patient_dob date,referrer_name text,referrer_address text,
 report_type text,source_type text,source_text text,ai_generated_text text,edited_text text,status text,provider_approved_at timestamptz,
 attached_to_praktika_at timestamptz,deleted_at timestamptz,created_at timestamptz,updated_at timestamptz,uploaded_to_praktika boolean,
 scheduled_for_cleanup_at timestamptz,uploaded_to_praktika_at timestamptz,praktika_patient_id text,emailed_to_referrer_at timestamptz,
 emailed_to_referrer_email text,emailed_to_referrer_resend_id text,drafted_by_initials text,drafted_by_name text,approved_by_initials text,
 approved_by_name text,emailed_by_initials text,emailed_by_name text,uploaded_by_initials text,uploaded_by_name text,completed_at timestamptz,
 sensitive_source_deleted_at timestamptz,ai_text_deleted_at timestamptz,final_text_deleted_at timestamptz,retention_status text,
 periodontal_chart_attached_at timestamptz,periodontal_chart_attachment_name text,periodontal_chart_attachment_error text,typist_instructions text,
 praktika_letter_icon_updated_at timestamptz,praktika_letter_icon_appointment_id text,praktika_letter_icon_update_mode text,
 praktika_letter_icon_update_response_preview text,workflow_status text,workflow_started_at timestamptz,workflow_completed_at timestamptz,
 workflow_error text,workflow_praktika_upload_status text,workflow_icon_update_status text,workflow_mediref_status text,
 workflow_periodontal_chart_status text,workflow_last_message text,typist_queries text,sent_for_provider_review_at timestamptz);
create table praktika_helper_jobs(id uuid primary key default gen_random_uuid(),app_user_id uuid,job_type text,status text,priority integer,
 request jsonb,response jsonb,error_message text,attempts integer,locked_at timestamptz,locked_by text,available_at timestamptz,
 completed_at timestamptz,failed_at timestamptz,created_at timestamptz,updated_at timestamptz);
create table mediref_helper_jobs(id uuid primary key,app_user_id uuid,session_id uuid,job_type text,payload jsonb,result jsonb,error text,
 status text,priority integer,available_at timestamptz,locked_at timestamptz,locked_by text,attempts integer,created_at timestamptz,updated_at timestamptz);
create table report_writing_audit_events(id uuid primary key default gen_random_uuid(),actor_full_name text,actor_initials text,actor_email text,
 action text,entity_type text,entity_id text,provider_id uuid,patient_name text,details jsonb default '{}',created_at timestamptz default now());
alter table report_writing_audit_events enable row level security;
grant usage on schema public,extensions to anon,authenticated,service_role;
grant all on all tables in schema public to anon,authenticated,service_role;
"""
class Tests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  sql(SCHEMA);
  sql('create table user_status(user_id uuid,is_active boolean);create table user_roles(user_id uuid,role text);create table providers(id uuid,is_active boolean);grant all on user_status,user_roles,providers to service_role;')
  sql((ROOT/'supabase/migrations/202609110001_praktika_workflow_reservation.sql').read_text())
  sql((ROOT/'supabase/migrations/20260915084515_workflow_manual_verification.sql').read_text())
  sql(MIGRATION.read_text());
 def setUp(self):
  self.d,self.u,self.i,self.m,self.a,self.actor,self.provider=[str(uuid.uuid4()) for _ in range(7)]
  self.stamp='2026-08-01T12:00:00+00:00'
  self.draft=dict(id=self.d,provider_id=self.provider,created_by=self.actor,patient_name='Synthetic Fixture',created_at=self.stamp,updated_at=self.stamp,
   source_text='synthetic source',ai_generated_text='synthetic ai',edited_text='synthetic final',status='approved',workflow_status='completed',
   workflow_praktika_upload_status='completed',workflow_icon_update_status='completed',workflow_mediref_status='completed',workflow_periodontal_chart_status='skipped',
   praktika_patient_id='123',praktika_letter_icon_appointment_id=self.d,praktika_letter_icon_updated_at=self.stamp,praktika_letter_icon_update_response_preview='{"saved":true}')
  insert('report_drafts',self.draft)
  file=dict(path=f'report-uploads/{self.actor}/{self.d}/123-letter.pdf',fileName='letter.pdf',bucket='private',contentType='application/pdf',fieldName='patient_communication[file][file]')
  insert('praktika_helper_jobs',dict(id=self.u,app_user_id=self.actor,job_type='upload_report_to_praktika',status='completed',attempts=1,created_at=self.stamp,updated_at=self.stamp,
   request=dict(method='POST',path='/php/forms/db_updateFormData.php',contentType='multipart_storage',body=dict(file=file,fields={'patient_id':'123','patient_communication[file][name]':'letter.pdf'})),response={'patient_communication':{'iFileId':42}}))
  insert('praktika_helper_jobs',dict(id=self.i,app_user_id=self.actor,job_type='update_praktika_letter_icons',status='completed',created_at=self.stamp,updated_at=self.stamp,
   request={'body':[{'appointment_id':self.d}]},response={'saved':True}))
  insert('mediref_helper_jobs',dict(id=self.m,job_type='send_mediref_letter',status='completed',payload={'draftId':self.d},result={'prepared':True,'sent':False},created_at=self.stamp,updated_at=self.stamp))
  insert('report_writing_audit_events',dict(id=self.a,entity_type='report_draft',entity_id=self.d,action='Queued report upload to Praktika',details={'helperJobId':self.u,'stagedPdf':dict(storagePath=file['path'],bucket='private',fileName='letter.pdf',contentType='application/pdf'),'praktikaPatientId':'123','actorUserId':self.actor}))
  sql(f"insert into user_status values('{self.actor}',true);insert into user_roles values('{self.actor}','typist');insert into providers values('{self.provider}',true);")
  self.proposal=self.inspect();self.assertTrue(self.proposal['ok'],self.proposal)
 def inspect(self):return json.loads(sql(f"select public.inspect_historical_workflow('{self.d}');"))
 def call(self,dry=False,version='fixture-v1'):
  return f"select public.reconcile_historical_workflow('{self.d}','{self.proposal['fingerprint']}','{version}',{str(dry).lower()});"
 def result(self,**kw):return json.loads(sql(self.call(**kw)))
 def count(self):return int(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation';"))
 def release_call(self,execute=True):
  return f"select release_historical_retention('{self.d}','{self.proposal['eventId']}','synthetic-review',{str(execute).lower()});"
 def app_state(self):
  data=sql(f"select jsonb_build_object('draft',to_jsonb(d),'events',(select jsonb_agg(to_jsonb(a)) from report_writing_audit_events a where entity_id=d.id::text)) from report_drafts d where id='{self.d}';")
  script="""const fs=require('fs');const {resolveWorkflow,shouldAppearInApproved}=require('./lib/report-writing/resolved-workflow.ts');const {retentionPlan,retentionSettings}=require('./lib/report-writing/retention.ts');const x=JSON.parse(fs.readFileSync(0,'utf8'));const r=resolveWorkflow(x.draft,{uploads:[],icons:[],mediref:[],reconciliations:x.events,livePraktikaActors:new Set(),liveMediref:false});const d={...x.draft,workflow_resolved:r};console.log(JSON.stringify({status:r.status,held:r.historicalRetention?.released===false,approved:shouldAppearInApproved(d),plan:retentionPlan(d,retentionSettings({})),completedAt:r.completedAt}));"""
  r=cmd(['node','--import','tsx','-e',script],cwd=ROOT,input=data);self.assertEqual(r.returncode,0,r.stderr);return json.loads(r.stdout)
 def retention_audit(self,change=None):
  row=dict(entity_type='report_draft',entity_id=self.d,actor_full_name='System retention cleanup',actor_initials='SYS',action='Retention cleanup deleted sensitive text',details=dict(deletedFields=['source_text','ai_generated_text'],sourceDays=30,aiDays=30,finalDays=90,deleteFinalText=False,authoritativeCompletedAt=self.stamp))
  if change:change(row)
  return f"insert into report_writing_audit_events(entity_type,entity_id,actor_full_name,actor_initials,action,details) select entity_type,entity_id,actor_full_name,actor_initials,action,details from jsonb_populate_record(null::report_writing_audit_events,{literal(row)});"
 def test_complete_retention_sequence(self):
  self.result();held=self.app_state();self.assertTrue(held['held']);self.assertIsNone(held['plan']);self.assertFalse(held['approved'])
  self.assertEqual(json.loads(sql(self.release_call(False)))['code'],'release_eligible');self.assertTrue(self.app_state()['held'])
  self.assertEqual(json.loads(sql('set role service_role;'+self.release_call()))['code'],'released')
  released=self.app_state();self.assertFalse(released['held']);self.assertEqual(held['completedAt'],released['completedAt'])
  self.assertEqual(set(released['plan']['deletedFields']),{'source_text','ai_generated_text'})
  sql(f"update report_drafts set source_text=null,ai_generated_text=null,sensitive_source_deleted_at=now(),ai_text_deleted_at=now(),updated_at=now() where id='{self.d}';")
  sql('set role service_role;'+self.retention_audit())
  final=self.app_state();self.assertEqual(final['status'],'completed');self.assertFalse(final['approved']);self.assertEqual(held['completedAt'],final['completedAt'])
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated'"),'0')
  self.assertEqual(sql(f"select edited_text from report_drafts where id='{self.d}'"),'synthetic final')
 def test_release_security_and_idempotency(self):
  self.result()
  for role in ['anon','authenticated']:
   sql(f'set role {role};'+self.release_call(),False);sql(f'set role {role};'+self.retention_audit(),False)
  sql("set role service_role;insert into report_writing_audit_events(action,entity_type,entity_id,details) values('system_historical_retention_released','report_draft','fixture','{}');",False)
  first=json.loads(sql(self.release_call()));second=json.loads(sql(self.release_call()));self.assertEqual(first['eventId'],second['eventId']);self.assertEqual(second['code'],'already_released')
  for op in [f"update report_writing_audit_events set details='{{}}' where id='{first['eventId']}'",f"delete from report_writing_audit_events where id='{first['eventId']}'"]:sql('set role service_role;'+op,False)
 def test_malformed_retention_audits_not_exempt(self):
  self.result();sql(self.release_call())
  changes=[lambda r:r.update(actor_initials='OTHER'),lambda r:r['details'].update(extra='fake'),lambda r:r['details'].update(deletedFields=['patient_name']),lambda r:r['details'].update(authoritativeCompletedAt='2026-09-01T00:00:00Z'),lambda r:r.update(action='Retention cleanup deleted sensitive text fake'),lambda r:r['details'].update(sourceDays=-1),lambda r:r['details'].update(deleteFinalText='false'),lambda r:r['details'].update(deletedFields=['source_text','source_text'])]
  for change in changes:
   result=sql('begin;'+f"update report_drafts set source_text=null,ai_generated_text=null,sensitive_source_deleted_at=now(),ai_text_deleted_at=now() where id='{self.d}';"+self.retention_audit(change)+f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';rollback;")
   self.assertEqual(result,'1')
  # Even an exact-looking event is not legitimate before its fields are cleared.
  sql(self.retention_audit());self.assertFalse(self.result()['ok'])
 def test_retention_audit_cannot_bypass_hold_and_updates_are_not_exempt(self):
  self.result()
  clear=f"update report_drafts set source_text=null,ai_generated_text=null,sensitive_source_deleted_at=now(),ai_text_deleted_at=now() where id='{self.d}';"
  output=sql('begin;'+clear+self.retention_audit()+f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';rollback;")
  self.assertEqual(output,'1')
  sql(self.release_call());sql(clear+self.retention_audit())
  sql(f"update report_writing_audit_events set actor_initials='changed' where entity_id='{self.d}' and action='Retention cleanup deleted sensitive text';")
  self.assertFalse(self.result()['ok'])
 def test_concurrent_release_is_idempotent(self):
  self.result()
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:json.loads(sql(self.release_call())),range(4)))
  self.assertTrue(all(r['ok'] or r['code']=='busy' for r in results))
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_retention_released';"),'1')
 def test_released_workflow_still_invalidates_for_real_activity(self):
  self.result();sql(self.release_call())
  operations=[
   f"insert into praktika_helper_jobs(job_type,status,request) values('complete_report_workflow','waiting','{{\"reportDraftId\":\"{self.d}\"}}');",
   f"insert into praktika_helper_jobs(job_type,status,request) values('upload_report_to_praktika','pending','{{\"reportDraftId\":\"{self.d}\",\"manualRetry\":{{}}}}');",
   f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');",
   f"insert into praktika_helper_jobs(job_type,status,request) values('update_praktika_letter_icons','pending','{{\"body\":[{{\"appointment_id\":\"{self.d}\"}}]}}');",
   f"update report_drafts set periodontal_chart_attachment_error='synthetic contradiction' where id='{self.d}';",
   f"update report_drafts set workflow_status='running' where id='{self.d}';",
   f"update report_drafts set provider_approved_at=now() where id='{self.d}';",
   f"update praktika_helper_jobs set response='{{}}' where id='{self.u}';",
   f"insert into report_writing_audit_events(entity_type,entity_id,action) values('report_draft','{self.d}','Manual workflow verification');"]
  for op in operations:
   output=sql('begin;'+op+f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';rollback;")
   self.assertEqual(output,'1')
  sql("insert into report_writing_audit_events(entity_type,entity_id,action) values('report_draft',gen_random_uuid()::text,'Unrelated draft activity');")
  self.assertEqual(self.app_state()['status'],'completed')
 def test_release_races_with_new_work(self):
  self.result()
  op=f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,'begin;'+op+'select pg_sleep(.7);rollback;');time.sleep(.2)
   self.assertEqual(json.loads(sql(self.release_call()))['code'],'busy');f.result()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,'begin;'+self.release_call()+'select pg_sleep(.7);commit;');time.sleep(.2)
   sql(op);f.result()
  self.assertNotEqual(self.app_state()['status'],'completed');self.assertIsNone(self.app_state()['plan'])
  self.assertEqual(json.loads(sql(self.release_call()))['code'],'superseded')
 def test_valid_and_idempotent(self):
  before=sql(f"select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j where id in ('{self.u}','{self.i}');")
  a=self.result();b=self.result(version='fixture-v2');self.assertTrue(a['ok']);self.assertEqual(a['eventId'],b['eventId']);self.assertEqual(b['code'],'already_reconciled');self.assertEqual(self.count(),1)
  self.assertEqual(before,sql(f"select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j where id in ('{self.u}','{self.i}');"))
  event=json.loads(sql(f"select details from report_writing_audit_events where id='{a['eventId']}';"))
  self.assertEqual(event['branches']['periodontal']['outcome'],'skipped');self.assertNotEqual(event['reconciledAt'],event['historicalCompletedAt'])
 def test_dry_run_and_rollback(self):
  self.assertEqual(self.result(dry=True)['code'],'eligible');self.assertEqual(self.count(),0)
  sql('begin;'+self.call()+'rollback;');self.assertEqual(self.count(),0)
 def test_clients_and_direct_service_insert_denied(self):
  for role in ['anon','authenticated']:
   sql(f'set role {role};'+self.call(),False)
   sql(f"set role {role};insert into report_writing_audit_events(action) values('ordinary');",False)
  self.assertTrue(json.loads(sql('set role service_role;'+self.call()))['ok'])
  sql("set role service_role;insert into report_writing_audit_events(action,entity_type,entity_id,details) values('ordinary','report_draft','fixture','{}');")
  sql("set role service_role;insert into report_writing_audit_events(action,entity_type,entity_id,details) values('system_historical_reconciliation','report_draft','fixture','{}');",False)
 def test_immutable(self):
  self.result()
  for q in [f"update report_writing_audit_events set details='{{}}' where id='{self.proposal['eventId']}'",f"delete from report_writing_audit_events where id='{self.proposal['eventId']}'",'truncate report_writing_audit_events']:
   sql('set role service_role;'+q,False)
 def test_changed_and_deleted_draft(self):
  sql(f"update report_drafts set edited_text='changed' where id='{self.d}';");self.assertFalse(self.result()['ok'])
  sql(f"update report_drafts set deleted_at=now() where id='{self.d}';");self.assertFalse(self.result()['ok'])
 def test_changed_missing_contradictory_evidence(self):
  for field,value in [('response',"'{}'::jsonb"),('status',"'failed'"),('request',"request||'{\"manualRetry\":{}}'::jsonb")]:
   output=sql('begin;'+f"update praktika_helper_jobs set {field}={value} where id='{self.u}';"+self.call()+'rollback;')
   self.assertFalse(json.loads(output)['ok'])
  sql(f"delete from praktika_helper_jobs where id='{self.u}';");self.assertFalse(self.result()['ok'])
 def test_multiple_upload(self):
  sql(f"insert into praktika_helper_jobs(id,job_type,status,request) select gen_random_uuid(),job_type,'failed',request from praktika_helper_jobs where id='{self.u}';")
  self.assertFalse(self.result()['ok'])
 def test_new_parent_or_mediref(self):
  for table,q in [('parent',f"insert into praktika_helper_jobs(id,job_type,status,request) values(gen_random_uuid(),'complete_report_workflow','waiting','{{\"reportDraftId\":\"{self.d}\"}}');"),('med',f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');")]:
   output=sql('begin;'+q+self.call()+'rollback;');self.assertIn('"ok": false',output)
 def test_superseding_write_invalidates_atomically(self):
  self.result();sql(f"insert into praktika_helper_jobs(id,job_type,status,request) values(gen_random_uuid(),'upload_report_to_praktika','pending','{{\"reportDraftId\":\"{self.d}\"}}');")
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';"),'1')
  self.assertFalse(self.result()['ok'])
 def test_retention_clearing_does_not_invalidate(self):
  self.result();sql(f"update report_drafts set source_text=null,sensitive_source_deleted_at=now(),updated_at=now() where id='{self.d}';")
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';"),'0')
 def test_draft_edit_invalidates_without_recursive_row_update(self):
  self.result();sql(f"update report_drafts set edited_text='Synthetic revised letter' where id='{self.d}';")
  self.assertEqual(sql(f"select edited_text from report_drafts where id='{self.d}';"),'Synthetic revised letter')
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated';"),'1')
  self.assertFalse(self.result()['ok'])
 def test_new_draft_audit_invalidates(self):
  self.result();sql(f"insert into report_writing_audit_events(action,entity_type,entity_id) values('Synthetic verification','report_draft','{self.d}');")
  self.assertFalse(self.result()['ok'])
 def test_noncanonical_artifact_path_still_invalidates(self):
  self.result();sql(f"insert into praktika_helper_jobs(job_type,status,request) values('upload_report_to_praktika','pending','{{\"body\":{{\"file\":{{\"path\":\"unexpected/{self.d}/letter.pdf\"}}}}}}');")
  self.assertFalse(self.result()['ok'])
 def test_concurrent_calls(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p:rs=list(p.map(lambda _:self.result(),range(4)))
  self.assertEqual(self.count(),1);self.assertTrue(all(r['ok'] or r['code']=='busy' for r in rs))
 def test_writer_first_reconciliation_busy(self):
  q=f"begin;insert into praktika_helper_jobs(id,job_type,status,request) values(gen_random_uuid(),'upload_report_to_praktika','pending','{{\"reportDraftId\":\"{self.d}\"}}');select pg_sleep(1);commit;"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,q);time.sleep(.25);self.assertEqual(self.result()['code'],'busy');f.result()
  self.assertFalse(self.result()['ok']);self.assertEqual(self.count(),0)
 def test_reconcile_first_writer_invalidates(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,'begin;'+self.call()+'select pg_sleep(1);commit;');time.sleep(.25)
   sql(f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');")
   f.result()
  self.assertFalse(self.result()['ok']);self.assertEqual(self.count(),1)
 def test_duplicate_migration_aborts(self):
  sql(MIGRATION.read_text(),False);self.assertTrue(self.inspect()['ok'])
 def test_real_reservation_retry_and_verification_row_lock_races(self):
  operations=[f"select reserve_praktika_workflow('{self.d}','{self.actor}','{{}}');",
   f"select reserve_praktika_upload_retry('{self.d}','{self.u}','{self.actor}');",
   f"select verify_workflow_completion('{self.d}','praktika','{self.u}','{self.actor}',true);"]
  # Reservation can create a modern parent; each scenario uses a rolled-back writer.
  for op in operations:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    f=pool.submit(sql,'begin;'+op+'select pg_sleep(.7);rollback;');time.sleep(.2)
    self.assertEqual(self.result()['code'],'busy');f.result()
   self.assertTrue(self.inspect()['ok']);self.assertEqual(self.count(),0)
 def test_original_mediref_draft_and_job_state_preserved(self):
  before=sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';")
  med=sql(f"select to_jsonb(j) from mediref_helper_jobs j where id='{self.m}';")
  counts=sql('select (select count(*) from praktika_helper_jobs),(select count(*) from mediref_helper_jobs);')
  self.result();self.assertEqual(before,sql(f"select to_jsonb(d) from report_drafts d where id='{self.d}';"))
  self.assertEqual(med,sql(f"select to_jsonb(j) from mediref_helper_jobs j where id='{self.m}';"))
  self.assertEqual(counts,sql('select (select count(*) from praktika_helper_jobs),(select count(*) from mediref_helper_jobs);'))
 def test_source_truncate_protected(self):
  self.result()
  for table in ['report_drafts','praktika_helper_jobs','mediref_helper_jobs']:sql('set role service_role;truncate '+table,False)
 def test_audit_link_and_reference_update_invalidate(self):
  self.result();sql(f"update praktika_helper_jobs set error_message='synthetic change' where id='{self.u}';")
  self.assertFalse(self.result()['ok'])
 def test_exclusions(self):
  for name in [' test test ','TESTING TESTING','Siobhan Gannon']:
   output=sql('begin;'+f"update report_drafts set patient_name='{name}' where id='{self.d}';"+self.call()+'rollback;')
   self.assertFalse(json.loads(output)['ok'])
 def test_invalid_reserved_structure_rejected(self):
  sql(f"insert into report_writing_audit_events(action,entity_type,entity_id,details) values('system_historical_reconciliation','report_draft','{self.d}','{{\"source\":\"controlled_historical_cleanup\",\"contract\":\"historical-v1\",\"epoch\":\"fixture\"}}');",False)
 def test_missing_completion_time_is_not_fabricated(self):
  sql(f"update praktika_helper_jobs set completed_at=null,updated_at=null where id='{self.u}';")
  self.assertIsNone(self.inspect()['historicalCompletedAt'])
 def test_reconciliation_rollback_restores_everything(self):
  sql('begin;'+self.call()+f"insert into praktika_helper_jobs(id,job_type,status,request) values(gen_random_uuid(),'upload_report_to_praktika','pending','{{\"reportDraftId\":\"{self.d}\"}}');rollback;")
  self.assertEqual(self.count(),0);self.assertTrue(self.inspect()['ok'])
 def test_index_present(self):
  self.assertEqual(sql("select count(*) from pg_indexes where indexname in ('report_historical_reconciliation_epoch_idx','report_historical_reconciliation_fences_idx');"),'2')
 def test_populated_lookup_uses_indexes(self):
  self.result()
  setup=f"""begin;
   insert into report_writing_audit_events(id,action,entity_type,entity_id,details)
   select x.id,a.action,a.entity_type,x.id::text,a.details||jsonb_build_object('eventId',x.id,'draftId',x.id,'fenceKeys',jsonb_build_array('draft:'||x.id::text))
   from report_writing_audit_events a cross join (select md5('synthetic-index-fixture:'||g)::uuid id from generate_series(1,5000) g) x
   where a.entity_id='{self.d}' and a.action='system_historical_reconciliation';
   analyze report_writing_audit_events;
  """
  plan=sql(setup+f"explain (analyze,format json) select id,action,entity_id,details from report_writing_audit_events where entity_id in ('{self.d}') and action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released');rollback;")
  self.assertIn('report_historical_reconciliation_epoch_idx',plan)
  plan=sql(setup+f"explain (analyze,format json) select id from report_writing_audit_events where action='system_historical_reconciliation' and (details->'fenceKeys') ?| array['draft:{self.d}'];rollback;")
  self.assertIn('report_historical_reconciliation_fences_idx',plan)

if __name__=='__main__':
 started=False
 try:
  r=cmd([BIN/'initdb','-D',CLUSTER/'data','-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);assert not r.returncode,r.stderr
  r=cmd([BIN/'pg_ctl','-D',CLUSTER/'data','-l',CLUSTER/'server.log','-o',f"-k {CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert not r.returncode,r.stderr;started=True
  unittest.main()
 finally:
  if started:cmd([BIN/'pg_ctl','-D',CLUSTER/'data','-m','immediate','-w','stop'])
