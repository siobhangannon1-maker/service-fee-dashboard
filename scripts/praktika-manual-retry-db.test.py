"""Synthetic-only retry RPC tests, private local PostgreSQL socket. No env files."""
import concurrent.futures
import importlib.util
import json
import pathlib
import unittest
import uuid
import sys
sys.dont_write_bytecode = True

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reservation_fixture', ROOT / 'scripts/praktika-workflow-reservation-db.test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.ARGS += ['-U', 'localtest']
sql = base.sql

class RetryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        base.ReservationTests.setUpClass()
        sql('create table user_status(user_id uuid,is_active boolean); grant all on report_drafts,praktika_helper_jobs,user_status to service_role;')
        sql((ROOT / 'supabase/migrations/20260915060642_praktika_manual_retry.sql').read_text())
        sql('create table user_roles(user_id uuid,role text); create table providers(id uuid primary key,is_active boolean); grant select on user_roles,providers to service_role;')
        sql((ROOT / 'supabase/migrations/20260915065053_praktika_retry_typist_authorization.sql').read_text())
        sql((ROOT / 'supabase/migrations/20260915075240_praktika_retry_execution_routing.sql').read_text())

    def setUp(self):
        self.draft, self.actor, self.prior = [str(uuid.uuid4()) for _ in range(3)]
        sql(f"insert into report_drafts(id,provider_id,created_by) values('{self.draft}',gen_random_uuid(),gen_random_uuid()); insert into user_status values('{self.actor}',true);")
        sql(f"insert into user_roles values('{self.actor}','typist'); insert into providers select provider_id,true from report_drafts where id='{self.draft}';")
        self.parent = json.loads(sql(f"select reserve_praktika_workflow('{self.draft}','{self.actor}','{{}}');").stdout)['intentId']
        request = json.dumps({'reportDraftId':self.draft,'continuationId':self.parent,'body':{'file':{'path':'synthetic.pdf'}}})
        sql(f"insert into praktika_helper_jobs(id,app_user_id,job_type,status,attempts,error_message,request) values('{self.prior}','{self.actor}','upload_report_to_praktika','failed',1,'Unconfirmed','{request}'); update praktika_helper_jobs set status='failed' where id='{self.parent}'; update report_drafts set workflow_status='failed',workflow_mediref_status='completed',workflow_praktika_upload_status='running' where id='{self.draft}';")
        self.original = sql(f"select row_to_json(j) from praktika_helper_jobs j where id='{self.prior}';").stdout

    def call(self, prior=None, actor=None):
        return f"select reserve_praktika_upload_retry('{self.draft}','{prior or self.prior}','{actor or self.actor}');"

    def result(self, **kw):
        return json.loads(sql(self.call(**kw)).stdout)

    def count(self):
        return int(sql(f"select count(*) from praktika_helper_jobs where job_type='upload_report_to_praktika' and request->>'reportDraftId'='{self.draft}';").stdout)

    def test_atomic_new_waiting_intent_preserves_old_and_mediref(self):
        r=self.result(); self.assertTrue(r['ok']); self.assertNotEqual(r['uploadJobId'],self.prior)
        self.assertEqual(sql(f"select app_user_id from praktika_helper_jobs where id='{r['uploadJobId']}';").stdout.strip(),self.actor)
        self.assertEqual(r['uploadStatus'],'waiting'); self.assertEqual(self.count(),2)
        self.assertEqual(self.original,sql(f"select row_to_json(j) from praktika_helper_jobs j where id='{self.prior}';").stdout)
        self.assertEqual(sql(f"select workflow_mediref_status from report_drafts where id='{self.draft}';").stdout.strip(),'completed')
        meta=json.loads(sql(f"select request->'manualRetry' from praktika_helper_jobs where id='{r['uploadJobId']}';").stdout)
        self.assertTrue(meta['verifiedAbsent']); self.assertEqual(meta['actorUserId'],self.actor); self.assertEqual(meta['priorJobId'],self.prior)

    def test_duplicate_and_lost_ack(self):
        a=self.result(); b=self.result(); self.assertEqual(a['uploadJobId'],b['uploadJobId']); self.assertTrue(b['reconciled']); self.assertEqual(self.count(),2)

    def test_concurrent_tabs(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(lambda _:self.result(),range(8)))
        self.assertTrue(all(r['ok'] for r in results)); self.assertEqual(len({r['uploadJobId'] for r in results}),1); self.assertEqual(self.count(),2)

    def test_rollback(self):
        sql('begin;'+self.call()+'rollback;'); self.assertEqual(self.count(),1)
        self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';").stdout.strip(),'failed')

    def test_process_interruption(self):
        sql('begin;'+self.call()); self.assertEqual(self.count(),1)

    def test_failure_after_insert_rolls_back(self):
        sql("create function reject_retry_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$; create trigger reject_retry_fixture before update on report_drafts for each row execute function reject_retry_fixture();")
        try:
            self.assertNotEqual(sql(self.call(),check=False).returncode,0); self.assertEqual(self.count(),1)
            self.assertEqual(sql(f"select status from praktika_helper_jobs where id='{self.parent}';").stdout.strip(),'failed')
        finally: sql('drop trigger reject_retry_fixture on report_drafts; drop function reject_retry_fixture();')

    def test_other_authorized_actor_and_concurrency(self):
        other=str(uuid.uuid4())
        sql(f"insert into user_status values('{other}',true); insert into user_roles values('{other}','typist');")
        actors=[self.actor,other]*4
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda actor:self.result(actor=actor),actors))
        self.assertTrue(all(r['ok'] for r in results)); self.assertEqual(len({r['uploadJobId'] for r in results}),1)
        winner=actors[next(i for i,r in enumerate(results) if not r['reconciled'])]
        job=results[0]['uploadJobId']
        before=sql(f"select request->'manualRetry' from praktika_helper_jobs where id='{job}';").stdout
        self.assertEqual(json.loads(before)['actorUserId'],winner)
        self.result(actor=other);self.assertEqual(before,sql(f"select request->'manualRetry' from praktika_helper_jobs where id='{job}';").stdout)
        self.assertEqual(sql(f"select app_user_id from praktika_helper_jobs where id='{self.parent}';").stdout.strip(),self.actor)
        self.assertEqual(sql(f"select app_user_id from praktika_helper_jobs where id='{job}';").stdout.strip(),winner)
        self.assertEqual(self.original,sql(f"select row_to_json(j) from praktika_helper_jobs j where id='{self.prior}';").stdout)
        self.assertEqual(self.count(),2)

    def test_different_typist_wins_then_another_explicit_retry(self):
        other=str(uuid.uuid4())
        sql(f"insert into user_status values('{other}',true); insert into user_roles values('{other}','typist');")
        original_parent=sql(f"select request from praktika_helper_jobs where id='{self.parent}';").stdout
        a=self.result(actor=other);self.assertTrue(a['ok'])
        meta=json.loads(sql(f"select request->'manualRetry' from praktika_helper_jobs where id='{a['uploadJobId']}';").stdout)
        self.assertEqual(meta['actorUserId'],other)
        self.assertEqual(sql(f"select app_user_id from praktika_helper_jobs where id='{a['uploadJobId']}';").stdout.strip(),other)
        self.assertEqual(sql(f"select response->>'retryExecutionUserId' from praktika_helper_jobs where id='{self.parent}';").stdout.strip(),other)
        self.assertEqual(self.result()['uploadJobId'],a['uploadJobId'])
        sql(f"update praktika_helper_jobs set status='failed' where id in ('{a['uploadJobId']}','{self.parent}');")
        self.assertEqual(self.result()['uploadJobId'],a['uploadJobId'])
        b=self.result(prior=a['uploadJobId']);self.assertTrue(b['ok']);self.assertNotEqual(a['uploadJobId'],b['uploadJobId'])
        self.assertEqual(original_parent,sql(f"select request from praktika_helper_jobs where id='{self.parent}';").stdout)
        self.assertEqual(sql(f"select workflow_mediref_status from report_drafts where id='{self.draft}';").stdout.strip(),'completed')

    def test_existing_misrouted_waiting_replacement_is_not_reassigned(self):
        other=str(uuid.uuid4())
        sql(f"insert into user_status values('{other}',true); insert into user_roles values('{other}','typist');")
        r=self.result(actor=other);job=r['uploadJobId']
        # Model the legacy reservation, on synthetic data only.
        sql(f"update praktika_helper_jobs set app_user_id='{self.actor}' where id='{job}'; update praktika_helper_jobs set response=response-'retryExecutionUserId' where id='{self.parent}';")
        before=sql(f"select row_to_json(j) from praktika_helper_jobs j where id in ('{job}','{self.parent}','{self.prior}') order by id;").stdout
        sql((ROOT / 'supabase/migrations/20260915075240_praktika_retry_execution_routing.sql').read_text())
        self.assertFalse(self.result(actor=other)['ok'])
        self.assertEqual(before,sql(f"select row_to_json(j) from praktika_helper_jobs j where id in ('{job}','{self.parent}','{self.prior}') order by id;").stdout)
        self.assertEqual(self.count(),2)

    def test_disallowed_role_and_inactive_provider(self):
        for role in ['staff','billing_staff','provider_readonly']:
            sql(f"update user_roles set role='{role}' where user_id='{self.actor}';")
            self.assertFalse(self.result()['ok'])
        sql(f"update user_roles set role='typist' where user_id='{self.actor}'; update providers set is_active=false where id=(select provider_id from report_drafts where id='{self.draft}');")
        self.assertFalse(self.result()['ok']);self.assertEqual(self.count(),1)

    def test_inactive_missing_duplicate_status(self):
        for action in [f"update user_status set is_active=false where user_id='{self.actor}'",f"delete from user_status where user_id='{self.actor}'",f"insert into user_status values('{self.actor}',true),('{self.actor}',true)"]:
            sql(action); self.assertFalse(self.result()['ok']); self.assertEqual(self.count(),1)

    def test_non_failed_attempts_block(self):
        for status in ['pending','processing','running','completed','waiting']:
            sql(f"update praktika_helper_jobs set status='{status}' where id='{self.prior}';")
            self.assertFalse(self.result()['ok']); self.assertEqual(self.count(),1)

    def test_unknown_historical_attempt_blocks(self):
        sql(f"insert into praktika_helper_jobs(job_type,status,request) values('upload_report_to_praktika','failed','{{\"reportDraftId\":\"{self.draft}\"}}');")
        self.assertFalse(self.result()['ok']); self.assertEqual(self.count(),2)

    def test_replacement_failure_requires_new_confirmation(self):
        a=self.result(); sql(f"update praktika_helper_jobs set status='failed' where id in ('{a['uploadJobId']}','{self.parent}');")
        self.assertEqual(self.result()['uploadJobId'],a['uploadJobId']); self.assertEqual(self.count(),2)
        b=self.result(prior=a['uploadJobId']); self.assertTrue(b['ok']); self.assertNotEqual(a['uploadJobId'],b['uploadJobId']); self.assertEqual(self.count(),3)

    def test_completed_replacement_never_reset_by_stale_click(self):
        a=self.result(); sql(f"update praktika_helper_jobs set status='completed' where id='{a['uploadJobId']}'; update report_drafts set uploaded_to_praktika=true,status='uploaded_to_praktika' where id='{self.draft}';")
        self.assertEqual(self.result()['uploadStatus'],'completed'); self.assertEqual(self.count(),2)

    def test_deleted_or_unapproved_or_confirmed_draft_denied(self):
        for change in ["deleted_at=now()","deleted_at=null,status='draft'","status='approved',uploaded_to_praktika=true"]:
            sql(f"update report_drafts set {change} where id='{self.draft}';"); self.assertFalse(self.result()['ok'])

    def test_remote_confirmation_blocks_even_if_status_failed(self):
        sql(f"update praktika_helper_jobs set response='{{\"patient_communication\":{{\"iFileId\":42}}}}' where id='{self.prior}';")
        self.assertFalse(self.result()['ok']); self.assertEqual(self.count(),1)

    def test_service_only_execute(self):
        for role in ['anon','authenticated']:
            r=sql(f'set role {role};'+self.call(),check=False); self.assertNotEqual(r.returncode,0)
        r=sql('set role service_role;'+self.call()); self.assertTrue(json.loads(r.stdout.splitlines()[-1])['ok'])

if __name__=='__main__': unittest.main(verbosity=2)
