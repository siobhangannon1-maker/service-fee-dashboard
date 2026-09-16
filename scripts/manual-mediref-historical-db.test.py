"""Disposable PostgreSQL only. No environment files, production or external actions."""
import importlib.util,pathlib,unittest,json,uuid
spec=importlib.util.spec_from_file_location('base',pathlib.Path(__file__).with_name('historical-reconciliation-db.test.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
sql=b.sql
class Tests(b.Tests):
 @classmethod
 def setUpClass(cls):
  b.Tests.setUpClass()
  sql('create schema auth;create table auth.users(id uuid primary key);')
  sql((b.ROOT/'supabase/migrations/20260916050207_manual_historical_mediref_verification.sql').read_text())
 def setUp(self):
  b.Tests.setUp(self)
  sql(f"insert into auth.users values('{self.actor}');update mediref_helper_jobs set status='failed',result=null,payload=payload||'{{\"attachments\":[{{\"fileName\":\"letter.pdf\"}}]}}' where id='{self.m}';update report_drafts set workflow_status='failed',workflow_mediref_status='failed' where id='{self.d}';")
  self.p=json.loads(sql(f"select inspect_manual_historical_mediref('{self.d}');"));self.assertTrue(self.p['ok'],self.p)
 def verify(self,dry=False,**kw):
  args=dict(epoch=self.p['epoch'],fp=self.p['fingerprint'],pdf=self.p['pdfFingerprint'],workbook='a'*64,manifest='b'*64,actor=self.actor,verified=self.stamp)
  args.update(kw)
  return "select verify_historical_mediref_completion('%s','%s','%s','%s','%s','%s','%s','%s',%s);"%(self.d,args['epoch'],args['fp'],args['pdf'],args['workbook'],args['manifest'],args['actor'],args['verified'],str(dry).lower())
 def check(self,**kw):return json.loads(sql('set role service_role;'+self.verify(**kw)))
 def events(self):return int(sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='manual_historical_mediref_verification';"))
 def test_manual_dryrun_idempotency(self):
  self.assertEqual(self.check(dry=True)['code'],'eligible');self.assertEqual(self.events(),0)
  self.assertEqual(self.check()['code'],'verified');self.assertEqual(self.check()['code'],'already_verified');self.assertEqual(self.events(),1)
  self.assertEqual(self.check(manifest='c'*64)['code'],'conflicting')
 def test_manual_no_mutation_or_resume(self):
  before=sql('select jsonb_agg(to_jsonb(j) order by id) from mediref_helper_jobs j;select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j;select jsonb_agg(to_jsonb(d) order by id) from report_drafts d;')
  self.check()
  self.assertEqual(before,sql('select jsonb_agg(to_jsonb(j) order by id) from mediref_helper_jobs j;select jsonb_agg(to_jsonb(j) order by id) from praktika_helper_jobs j;select jsonb_agg(to_jsonb(d) order by id) from report_drafts d;'))
 def test_manual_two_attempts(self):
  j=str(uuid.uuid4());sql(f"insert into mediref_helper_jobs select * from jsonb_populate_record(null::mediref_helper_jobs,(select to_jsonb(m)||jsonb_build_object('id','{j}') from mediref_helper_jobs m where id='{self.m}'));")
  self.p=json.loads(sql(f"select inspect_manual_historical_mediref('{self.d}');"));self.assertEqual(len(self.p['failedJobIds']),2)
  self.assertEqual(self.check()['code'],'verified');self.assertEqual(sql(f"select count(*) from mediref_helper_jobs where payload->>'draftId'='{self.d}' and status='failed'"),'2')
 def test_manual_drift(self):
  for q in [f"update report_drafts set edited_text='changed' where id='{self.d}';",f"update report_drafts set provider_approved_at=now() where id='{self.d}';",f"update mediref_helper_jobs set status='pending' where id='{self.m}';",f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','failed','{{\"draftId\":\"{self.d}\"}}');",f"insert into praktika_helper_jobs(job_type,status,request) values('complete_report_workflow','waiting','{{\"reportDraftId\":\"{self.d}\"}}');"]:
   r=json.loads(sql('begin;'+q+self.verify()+'rollback;'));self.assertFalse(r['ok'],r)
 def test_manual_authorization(self):
  for role in ['anon','authenticated']:sql('set role '+role+';'+self.verify(),False)
  for q in [f"update user_status set is_active=false where user_id='{self.actor}';",f"update user_roles set role='staff' where user_id='{self.actor}';",f"delete from auth.users where id='{self.actor}';"]:
   self.assertEqual(json.loads(sql('begin;'+q+self.verify()+'rollback;'))['code'],'forbidden')
 def test_manual_immutable(self):
  self.check()
  for role in ['anon','authenticated','service_role']:
   for op in [f"update report_writing_audit_events set details='{{}}' where id='{self.p['eventId']}';",f"delete from report_writing_audit_events where id='{self.p['eventId']}';",'truncate report_writing_audit_events;',"insert into report_writing_audit_events(action) values('manual_historical_mediref_verification');"]:sql('set role '+role+';'+op,False)
  for table in ['report_drafts','mediref_helper_jobs','praktika_helper_jobs']:sql('truncate '+table+';',False)
 def test_manual_invalidation(self):
  self.check()
  for q in [f"update report_drafts set edited_text='changed' where id='{self.d}';",f"update mediref_helper_jobs set attempts=2 where id='{self.m}';",f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');",f"update praktika_helper_jobs set response='{{}}' where id='{self.u}';"]:
   self.assertEqual(json.loads(sql('begin;'+q+self.verify()+'rollback;'))['code'],'superseded')
  sql(f"insert into report_writing_audit_events(action,entity_id) values('Unrelated admin review','{self.d}');")
  self.assertEqual(self.check()['code'],'already_verified')
 def test_manual_partial_branches(self):
  self.assertEqual(self.p['otherBranches'],dict(praktika='completed',icon='completed',periodontal='skipped'))
  sql(f"update report_drafts set workflow_periodontal_chart_status='completed',periodontal_chart_attachment_name='chart.pdf',periodontal_chart_attached_at=now() where id='{self.d}';")
  p=json.loads(sql(f"select inspect_manual_historical_mediref('{self.d}');"));self.assertEqual(p['otherBranches']['periodontal'],'unknown')
  sql(f"update praktika_helper_jobs set response='{{}}' where id='{self.u}';")
  p=json.loads(sql(f"select inspect_manual_historical_mediref('{self.d}');"));self.assertEqual(p['otherBranches']['praktika'],'unknown')
 def test_manual_rollback(self):
  sql('begin;'+self.verify()+'rollback;');self.assertEqual(self.events(),0)
 def test_manual_release_separate(self):
  self.check();q=f"select release_manual_historical_mediref_retention('{self.d}','{self.p['eventId']}','fixture-review'"
  self.assertEqual(json.loads(sql(q+');'))['code'],'release_eligible')
  self.assertEqual(sql("select count(*) from report_writing_audit_events where action='manual_historical_mediref_retention_released'"),'0')
  self.assertEqual(json.loads(sql(q+',true);'))['code'],'released');self.assertEqual(json.loads(sql(q+',true);'))['code'],'already_released')

 def test_manual_concurrent_duplicate(self):
  import concurrent.futures
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   results=list(pool.map(lambda _:self.check(),range(4)))
  self.assertTrue(all(r['code'] in ('verified','already_verified','busy') for r in results));self.assertEqual(self.events(),1)
 def test_manual_race_new_attempt(self):
  import concurrent.futures,time
  q=f"insert into mediref_helper_jobs(id,job_type,status,payload) values(gen_random_uuid(),'send_mediref_letter','pending','{{\"draftId\":\"{self.d}\"}}');"
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   f=pool.submit(sql,'begin;'+q+'select pg_sleep(0.7);commit;');time.sleep(.2)
   self.assertEqual(self.check()['code'],'busy');f.result()
  self.assertEqual(self.check()['code'],'superseded');self.assertEqual(self.events(),0)
 def test_manual_system_precedence(self):
  sql(f"update mediref_helper_jobs set status='completed',result='{{\"prepared\":true}}' where id='{self.m}';update report_drafts set workflow_status='completed',workflow_mediref_status='completed' where id='{self.d}';")
  proposal=self.inspect();self.assertTrue(proposal['ok']);sql(f"select reconcile_historical_workflow('{self.d}','{proposal['fingerprint']}','fixture',false);")
  self.assertFalse(self.check()['ok']);self.assertEqual(self.events(),0)
 def test_manual_existing_conflict_and_epoch(self):
  self.check();self.assertEqual(self.check(workbook='c'*64)['code'],'conflicting')
  sql(f"update report_drafts set provider_approved_at=now() where id='{self.d}';")
  self.assertEqual(self.check()['code'],'state_changed')
 def test_manual_retention_audit_exempt_and_held(self):
  self.check();sql(self.retention_audit())
  self.assertEqual(self.check()['code'],'already_verified')
  self.assertEqual(sql(f"select count(*) from report_writing_audit_events where action='manual_historical_mediref_retention_released' and entity_id='{self.d}'"),'0')
 def test_manual_runtime_database_end_to_end(self):
  self.check()
  data=sql(f"select jsonb_build_object('d',to_jsonb(d),'meds',(select jsonb_agg(to_jsonb(m)) from mediref_helper_jobs m where payload->>'draftId'=d.id::text),'events',(select jsonb_agg(to_jsonb(a)) from report_writing_audit_events a where entity_id=d.id::text)) from report_drafts d where id='{self.d}';")
  script="const x=JSON.parse(require('fs').readFileSync(0,'utf8'));const {resolveWorkflow,shouldAppearInApproved}=require('./lib/report-writing/resolved-workflow.ts');const {retentionPlan,retentionSettings}=require('./lib/report-writing/retention.ts');const r=resolveWorkflow(x.d,{uploads:[],icons:[],mediref:x.meds,reconciliations:x.events,livePraktikaActors:new Set(),liveMediref:false});console.log(JSON.stringify({status:r.status,held:r.historicalRetention?.released===false,approved:shouldAppearInApproved({...x.d,workflow_resolved:r}),retention:retentionPlan({...x.d,workflow_resolved:r},retentionSettings({})),human:r.historicalMedirefVerification?.source}));"
  r=b.cmd(['node','--import','tsx','-e',script],cwd=b.ROOT,input=data);self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual(json.loads(r.stdout),dict(status='completed',held=True,approved=False,retention=None,human='human_external_verification'))
 def test_manual_missing_status_and_duplicate_status(self):
  for q in [f"delete from user_status where user_id='{self.actor}';",f"insert into user_status values('{self.actor}',true);",f"update user_status set is_active=null where user_id='{self.actor}';"]:
   self.assertEqual(json.loads(sql('begin;'+q+self.verify()+'rollback;'))['code'],'forbidden')
 def test_manual_inactive_provider(self):
  sql(f"update providers set is_active=false where id='{self.provider}';");self.assertEqual(self.check()['code'],'blocked')
 def test_manual_fingerprint_pdf_guard(self):
  self.assertEqual(self.check(pdf='e'*64)['code'],'state_changed');self.assertEqual(self.check(fp='f'*64)['code'],'state_changed')
 def test_manual_security_function_contract(self):
  for sig in ['verify_historical_mediref_completion(uuid,text,text,text,text,text,uuid,timestamptz,boolean)','release_manual_historical_mediref_retention(uuid,uuid,text,boolean)','inspect_manual_historical_mediref(uuid)']:
   for role in ['anon','authenticated']:
    self.assertEqual(sql(f"select has_function_privilege('{role}','public.{sig}','EXECUTE')"),'f')
   self.assertEqual(sql(f"select has_function_privilege('service_role','public.{sig}','EXECUTE')"),'t')
  self.assertEqual(sql("select bool_and(prosecdef and proconfig @> array['search_path=\"\"']) from pg_proc where proname in ('verify_historical_mediref_completion','release_manual_historical_mediref_retention','inspect_manual_historical_mediref')"),'t')

 def test_manual_allowed_roles(self):
  for role in ['admin','super_admin','practice_manager','typist']:
   sql(f"update user_roles set role='{role}' where user_id='{self.actor}';");self.assertEqual(self.check(dry=True)['code'],'eligible')
  for role in ['staff','billing_staff','provider_readonly']:
   sql(f"update user_roles set role='{role}' where user_id='{self.actor}';");self.assertEqual(self.check()['code'],'forbidden')
 def test_manual_pdf_mismatch(self):
  sql(f"update mediref_helper_jobs set payload=jsonb_set(payload,'{{attachments}}','[{{\"fileName\":\"different.pdf\"}}]') where id='{self.m}';")
  self.assertEqual(self.check()['code'],'state_changed')
 def test_manual_invalid_attachment_set(self):
  sql(f"update mediref_helper_jobs set payload=jsonb_set(payload,'{{attachments}}','[{{\"fileName\":\"letter.pdf\"}},{{\"fileName\":\"another.pdf\"}}]') where id='{self.m}';")
  self.assertEqual(self.check()['code'],'invalid_evidence')
 def test_manual_ordinary_audit_logging(self):
  self.check();sql(f"set role service_role;insert into report_writing_audit_events(action,entity_id) values('Admin viewed history','{self.d}');")
  self.assertEqual(self.check()['code'],'already_verified')
 def test_manual_hold_release_permissions(self):
  self.check();q=f"select release_manual_historical_mediref_retention('{self.d}','{self.p['eventId']}','review',true);"
  for role in ['anon','authenticated']:sql('set role '+role+';'+q,False)
  sql("set role service_role;insert into report_writing_audit_events(action) values('manual_historical_mediref_retention_released');",False)
 def test_manual_no_fabricated_completion_time(self):
  self.check();v=json.loads(sql(f"select details from report_writing_audit_events where id='{self.p['eventId']}';"))
  self.assertIsNone(v['historicalCompletedAt']);self.assertEqual(v['source'],'human_external_verification')
  self.assertEqual(v['verifierUserId'],self.actor);self.assertNotIn('sent',v);self.assertNotIn('prepared',v);self.assertNotIn('result',v)
 def test_manual_runtime_index(self):
  self.check()
  query="select id from report_writing_audit_events where entity_id='"+self.d+"' and action in ('system_historical_reconciliation','system_historical_reconciliation_invalidated','system_historical_retention_released','manual_historical_mediref_verification','manual_historical_mediref_invalidated','manual_historical_mediref_retention_released')"
  plan=sql('begin;set local enable_seqscan=off;explain '+query+';rollback;');self.assertIn('historical_verification_runtime_idx',plan)
 def test_manual_no_external_or_queue_calls(self):
  src=(b.ROOT/'supabase/migrations/20260916050207_manual_historical_mediref_verification.sql').read_text().lower()
  for forbidden in ['insert into public.mediref_helper_jobs','insert into public.praktika_helper_jobs','update public.mediref_helper_jobs','update public.praktika_helper_jobs','update public.report_drafts','net.http','http_post','reserve_praktika','release_historical_retention(']:self.assertNotIn(forbidden,src)

class SystemWithManualInstalled(b.Tests):
 @classmethod
 def setUpClass(cls):Tests.setUpClass()

if __name__=='__main__':
 try:
  r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER/'data','-A','trust','-U','postgres','--encoding=UTF8','--no-locale']);assert r.returncode==0,r.stderr
  r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER/'data','-l',b.CLUSTER/'server.log','-o',f'-k {b.CLUSTER} -p 65438 -h ""','start']);assert r.returncode==0,r.stderr
  import sys
  suite=unittest.defaultTestLoader.loadTestsFromTestCase(SystemWithManualInstalled) if '--system-regressions' in sys.argv else unittest.TestSuite(Tests(name) for name in Tests.__dict__ if name.startswith('test_manual_'))
  result=unittest.TextTestRunner(verbosity=2).run(suite)
  raise SystemExit(0 if result.wasSuccessful() else 1)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER/'data','-m','immediate','stop'])
