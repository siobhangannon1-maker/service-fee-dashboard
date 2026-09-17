"""Focused disposable PostgreSQL tests. Synthetic data; no app credentials/network."""
import importlib.util,unittest,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('historical-reconciliation-db.test.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
f.ENV['PGPORT']='65446'
class Attention(f.Tests):
 @classmethod
 def setUpClass(cls):
  f.Tests.setUpClass()
  f.sql("create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;")
  f.sql((f.ROOT/'supabase/migrations/20260917075851_historical_attention_dispositions.sql').read_text())
 def setUp(self):
  super().setUp()
  f.sql(f"update user_roles set role='admin' where user_id='{self.actor}';")
  self.att=json.loads(f.sql(f"select inspect_historical_attention('{self.d}')"))
  self.art=f.sql(f"select encode(sha256(convert_to((request#>'{{body,file}}')::text,'UTF8')),'hex') from praktika_helper_jobs where id='{self.u}'")
 def attention(self,execute=True,kind='confirmed_upload',confirmed=False):
  return f"select disposition_historical_attention('{self.d}','{self.att['fingerprint']}','{'a'*64}','{self.u}','{self.art}','{kind}',{str(confirmed).lower()},{str(execute).lower()});"
 def runattention(self,**kwargs):
  return json.loads(f.sql(f"set role authenticated;set request.jwt.claim.sub='{self.actor}';"+self.attention(**kwargs)+'reset role;'))
 def events(self,action='historical_attention_disposition'):
  return int(f.sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='{action}'"))
 def test_attention_dry_run_and_idempotency(self):
  self.assertEqual(self.runattention(execute=False)['code'],'eligible');self.assertEqual(self.events(),0)
  self.assertEqual(self.runattention()['code'],'dispositioned');self.assertEqual(self.runattention()['code'],'already_dispositioned');self.assertEqual(self.events(),1)
 def test_attention_preserves_jobs_and_completion(self):
  before=f.sql(f"select to_jsonb(j) from praktika_helper_jobs j where id='{self.u}'")
  self.runattention();self.assertEqual(before,f.sql(f"select to_jsonb(j) from praktika_helper_jobs j where id='{self.u}'"))
  self.assertEqual(f.sql(f"select details->>'authorizerUserId' from report_writing_audit_events where entity_id='{self.d}' and action='historical_attention_disposition'"),self.actor)
  self.assertEqual(self.count(),0)
 def test_attention_forbidden_anon_service_inactive_role(self):
  for role in ['anon','service_role']:
   f.sql(f'set role {role};'+self.attention(),ok=False);f.sql('reset role;')
  f.sql(f"update user_roles set role='typist' where user_id='{self.actor}'")
  self.assertEqual(self.runattention()['code'],'forbidden')
  f.sql(f"update user_roles set role='admin' where user_id='{self.actor}';update user_status set is_active=false where user_id='{self.actor}'")
  self.assertEqual(self.runattention()['code'],'forbidden')
 def test_attention_missing_and_manual_pdf(self):
  f.sql(f"update praktika_helper_jobs set status='failed',response=null where id='{self.u}'")
  self.att=json.loads(f.sql(f"select inspect_historical_attention('{self.d}')"))
  self.assertEqual(self.runattention()['code'],'pdf_not_proven')
  self.assertEqual(self.runattention(kind='operator_attestation')['code'],'confirmation_required')
  self.assertEqual(self.runattention(kind='operator_attestation',confirmed=True)['code'],'dispositioned')
  self.assertEqual(f.sql(f"select status from praktika_helper_jobs where id='{self.u}'"),'failed')
 def test_attention_revision_and_job_invalidation(self):
  self.runattention()
  f.sql(f"update report_drafts set edited_text='new revision' where id='{self.d}'")
  self.assertEqual(self.events('historical_attention_invalidated'),1)
  self.assertEqual(self.runattention()['code'],'conflicting_or_superseded')
 def test_attention_new_mediref_invalidation(self):
  self.runattention();f.sql(f"update mediref_helper_jobs set status='pending' where id='{self.m}'")
  self.assertEqual(self.events('historical_attention_invalidated'),1)
 def test_attention_new_praktika_and_icon_invalidation(self):
  self.runattention();f.sql(f"update praktika_helper_jobs set status='failed' where id='{self.i}'")
  self.assertEqual(self.events('historical_attention_invalidated'),1)
 def test_attention_active_and_changed_snapshot(self):
  f.sql(f"update report_drafts set edited_text='changed' where id='{self.d}'")
  self.assertEqual(self.runattention()['code'],'state_changed')
  for status in ['waiting','pending','running','processing']:
   f.sql(f"update praktika_helper_jobs set status='{status}' where id='{self.u}'")
   self.assertEqual(self.runattention()['code'],'active_work')
 def test_attention_direct_event_and_immutability(self):
  self.runattention()
  for role in ['authenticated','service_role']:
   f.sql(f"set role {role};delete from report_writing_audit_events where entity_id='{self.d}' and action='historical_attention_disposition';",ok=False)
   f.sql('reset role;')
  f.sql("set role service_role;insert into report_writing_audit_events(entity_type,entity_id,action,details) values('report_draft','"+self.d+"','historical_attention_disposition','{\"source\":\"protected_historical_attention\"}');",ok=False)
 def test_attention_atomic_rollback(self):
  f.sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{self.actor}';"+self.attention()+"rollback;")
  self.assertEqual(self.events(),0)
 def test_attention_preserves_existing_reconciliation(self):
  self.assertEqual(self.result()['code'],'reconciled')
  self.att=json.loads(f.sql(f"select inspect_historical_attention('{self.d}')"))
  self.assertEqual(self.runattention()['code'],'dispositioned')
  self.assertEqual(int(f.sql(f"select count(*) from report_writing_audit_events where entity_id='{self.d}' and action='system_historical_reconciliation_invalidated'")),0)
 def test_attention_recent_failed_attempt_rejected(self):
  f.sql(f"update mediref_helper_jobs set status='failed',updated_at='2026-09-17T00:00:00Z' where id='{self.m}'")
  self.assertEqual(self.runattention()['code'],'current_work')
 def test_attention_concurrent_decisions_idempotent(self):
  import concurrent.futures
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   values=list(pool.map(lambda _:self.runattention(),range(2)))
  self.assertEqual(self.events(),1)
  self.assertTrue(all(v['code'] in ['dispositioned','already_dispositioned','busy'] for v in values))
 def test_attention_source_truncate_blocked(self):
  self.runattention();f.sql('truncate mediref_helper_jobs;',ok=False)
 def test_attention_wrong_patient_and_artifact(self):
  self.art='b'*64
  self.assertEqual(self.runattention()['code'],'artifact_or_patient_mismatch')
 def test_attention_new_approval_rejected(self):
  f.sql(f"update report_drafts set provider_approved_at='2026-09-17T00:00:00Z' where id='{self.d}'")
  self.assertEqual(self.runattention()['code'],'not_historical')
if __name__=='__main__':
 started=False
 try:
  r=f.cmd([f.BIN/'initdb','-D',f.CLUSTER/'data','-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);assert not r.returncode,r.stderr
  r=f.cmd([f.BIN/'pg_ctl','-D',f.CLUSTER/'data','-l',f.CLUSTER/'server.log','-o',f"-k {f.CLUSTER} -p 65446 -c listen_addresses=''",'-w','start']);assert not r.returncode,r.stderr;started=True
  suite=unittest.TestSuite(Attention(n) for n in sorted(dir(Attention)) if n.startswith('test_attention_'))
  result=unittest.TextTestRunner(verbosity=2).run(suite)
  if not result.wasSuccessful():raise SystemExit(1)
 finally:
  if started:f.cmd([f.BIN/'pg_ctl','-D',f.CLUSTER/'data','-m','immediate','-w','stop'])
