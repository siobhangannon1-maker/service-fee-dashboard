"""Disposable PostgreSQL only. Never reads application environment or production."""
import importlib.util, pathlib, sys, json, uuid, unittest, concurrent.futures
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('retry_fixture',ROOT/'scripts/praktika-manual-retry-db.test.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
sql=base.sql
class VerificationTests(base.RetryTests):
 @classmethod
 def setUpClass(cls):
  super().setUpClass()
  sql('create table mediref_helper_jobs(id uuid primary key,job_type text,status text,payload jsonb,attempts integer default 1,created_at timestamptz default now()); grant all on mediref_helper_jobs to service_role;')
  sql((ROOT/'supabase/migrations/20260915084515_workflow_manual_verification.sql').read_text())
 def setUp(self):
  super().setUp()
  migration=(ROOT/'supabase/migrations/20260915084515_workflow_manual_verification.sql').read_text()
  sql('begin;'+migration[migration.index('create or replace function public.reserve_praktika_upload_retry'):])
 def marksql(self,integration='praktika',actor=None,apply=True):
  return f"select verify_workflow_completion('{self.draft}','{integration}','{self.prior if integration=='praktika' else self.med}','{actor or self.actor}',{str(apply).lower()});"
 def mark(self,**kw):return json.loads(sql(self.marksql(**kw)).stdout)
 def medfixture(self):
  self.med=str(uuid.uuid4());sql(f"insert into mediref_helper_jobs(id,job_type,status,payload) values('{self.med}','send_mediref_letter','failed','{{\"draftId\":\"{self.draft}\",\"workflowContinuationId\":\"{self.parent}\"}}');update report_drafts set workflow_mediref_status='failed' where id='{self.draft}';")
 def test_mark_preserves_history_and_idempotency(self):
  sql(f"update report_drafts set workflow_icon_update_status='completed' where id='{self.draft}';")
  a=self.mark();b=self.mark();self.assertTrue(a['ok']);self.assertEqual(a['verification'],b['verification']);self.assertEqual(a['workflowStatus'],'completed')
  self.assertEqual(self.original,sql(f"select row_to_json(j) from praktika_helper_jobs j where id='{self.prior}';").stdout)
  self.assertEqual(self.count(),1);self.assertTrue(self.result()['manuallyVerified']);self.assertEqual(self.count(),1)
 def test_retry_wins(self):
  self.result();self.assertFalse(self.mark()['ok'])
 def test_mark_race_retry(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   results=list(pool.map(lambda q:json.loads(sql(q).stdout),[self.marksql(),self.call()]))
  if results[0]['ok']:self.assertEqual(self.count(),1);self.assertTrue(results[1]['manuallyVerified'])
  else:self.assertEqual(self.count(),2)
 def test_concurrent_typists(self):
  other=str(uuid.uuid4());sql(f"insert into user_roles values('{other}','typist');insert into user_status values('{other}',true);")
  for integration in ['praktika','mediref']:
   if integration=='mediref':self.medfixture()
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda a:self.mark(actor=a,integration=integration),[other,self.actor]*2))
   self.assertTrue(all(r['ok'] for r in results));self.assertEqual(len({json.dumps(r['verification'],sort_keys=True) for r in results}),1)
 def test_remaining_branch(self):
  self.medfixture();self.assertEqual(self.mark()['workflowStatus'],'failed')
  self.assertEqual(sql(f"select workflow_error from report_drafts where id='{self.draft}';").stdout.strip(),'MediRef needs verification.')
  sql(f"update report_drafts set workflow_icon_update_status='skipped' where id='{self.draft}';")
  original=sql(f"select row_to_json(j) from mediref_helper_jobs j where id='{self.med}';").stdout
  self.assertEqual(self.mark(integration='mediref')['workflowStatus'],'completed')
  self.assertEqual(original,sql(f"select row_to_json(j) from mediref_helper_jobs j where id='{self.med}';").stdout)
 def test_preview_and_rollback(self):
  self.assertTrue(self.mark(apply=False)['eligible']);self.assertEqual(self.count(),1)
  sql('begin;'+self.marksql()+'rollback;');self.assertFalse(self.mark()['reconciled'])
 def test_denials(self):
  for role in ['anon','authenticated']:
   self.assertNotEqual(sql('set role '+role+';'+self.marksql(),check=False).returncode,0)
  sql(f"update user_status set is_active=false where user_id='{self.actor}';");self.assertFalse(self.mark()['ok'])
 def test_med_retry_claim_wins(self):
  self.medfixture();sql(f"update report_drafts set workflow_mediref_status='pending' where id='{self.draft}';");self.assertFalse(self.mark(integration='mediref')['ok'])
 def test_mark_wins_med_retry_claim(self):
  self.medfixture();self.mark(integration='mediref');r=sql(f"update report_drafts set workflow_mediref_status='pending' where id='{self.draft}' and workflow_mediref_status='failed' returning id;").stdout
  self.assertNotIn(self.draft,r)
 def test_service_role_and_no_extra_jobs(self):
  r=json.loads(sql('set role service_role;'+self.marksql()).stdout.strip().splitlines()[-1])
  self.assertTrue(r['ok']);self.assertEqual(self.count(),1)
 def test_mark_atomic_failure(self):
  sql("create function reject_mark_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$; create trigger reject_mark_fixture before update on report_drafts for each row execute function reject_mark_fixture();")
  try:
   self.assertNotEqual(sql(self.marksql(),check=False).returncode,0)
   self.assertEqual(sql(f"select response ? 'manualVerification' from praktika_helper_jobs where id='{self.parent}';").stdout.strip(),'f')
  finally: sql('drop trigger reject_mark_fixture on report_drafts;drop function reject_mark_fixture();')
 def test_processing_continuation_denied(self):
  sql(f"update praktika_helper_jobs set status='processing',locked_by='fixture' where id='{self.parent}';")
  self.assertFalse(self.mark()['ok'])
 def test_wrong_attempt_denied(self):
  q=self.marksql().replace(self.prior,str(uuid.uuid4()))
  self.assertFalse(json.loads(sql(q).stdout)['ok'])
 def test_required_chart_retained(self):
  sql(f"update report_drafts set workflow_icon_update_status='completed',workflow_periodontal_chart_status='failed' where id='{self.draft}';")
  self.assertEqual(self.mark()['workflowStatus'],'failed')
if __name__=='__main__':unittest.main()
