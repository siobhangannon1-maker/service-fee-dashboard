"""Synthetic-only RPC checks. Requires an empty isolated database on local port 55439.
Run: python3 scripts/praktika-workflow-reservation-db.test.py
Never loads application environment files or connects to production.
"""
import concurrent.futures
import json
import pathlib
import subprocess
import unittest
import uuid

PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
ARGS = [PSQL, '-X', '-h', '/private/tmp/praktika-workflow-validation', '-p', '55439', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
ROOT = pathlib.Path(__file__).resolve().parents[1]


def sql(statement, check=True):
    result = subprocess.run(ARGS, input=statement, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result


class ReservationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Always create a fresh synthetic database; never drop/reset an existing one.
        database = 'workflow_fixture_' + uuid.uuid4().hex
        sql(f'create database {database};')
        ARGS[ARGS.index('-d') + 1] = database
        sql("""
        do $$ begin
          if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
        end $$;
        create table report_drafts (
          id uuid primary key, provider_id uuid not null, created_by uuid not null,
          status text not null default 'approved' check (status in ('draft','edited_by_typist','awaiting_provider_approval','approved','uploaded_to_praktika')),
          deleted_at timestamptz, uploaded_to_praktika boolean default false,
          workflow_status text, workflow_started_at timestamptz, workflow_completed_at timestamptz,
          workflow_error text, workflow_praktika_upload_status text, workflow_icon_update_status text,
          workflow_mediref_status text, workflow_periodontal_chart_status text,
          workflow_last_message text, updated_at timestamptz default now());
        create table praktika_helper_jobs (
          id uuid primary key default gen_random_uuid(), app_user_id uuid,
          job_type text not null, status text not null default 'pending', priority integer not null default 100,
          request jsonb not null, response jsonb, error_message text, attempts integer not null default 0,
          locked_at timestamptz, locked_by text, available_at timestamptz not null default now(),
          completed_at timestamptz, failed_at timestamptz,
          created_at timestamptz not null default now(), updated_at timestamptz not null default now());
        create index praktika_helper_jobs_pending_idx on praktika_helper_jobs(status,available_at,priority,created_at);
        create unique index praktika_hydrate_queue_pending_unique on praktika_helper_jobs((request->>'queueId'),job_type)
          where status in ('pending','running') and job_type='hydrate_report_letter_queue_item';
        """)
        sql((ROOT / 'supabase/migrations/202609100002_praktika_upload_attempt_lookup_index.sql').read_text())
        sql((ROOT / 'supabase/migrations/202609110001_praktika_workflow_reservation.sql').read_text())

    def setUp(self):
        self.draft, self.actor, self.provider = [str(uuid.uuid4()) for _ in range(3)]
        sql(f"insert into report_drafts(id,provider_id,created_by) values ('{self.draft}','{self.provider}','{self.provider}');")

    def call(self, actor=None, options='{}'):
        return f"select reserve_praktika_workflow('{self.draft}','{actor or self.actor}','{options}'::jsonb);"

    def result(self, **kwargs):
        return json.loads(sql(self.call(**kwargs)).stdout)

    def count(self):
        return int(sql(f"select count(*) from praktika_helper_jobs where request->>'reportDraftId'='{self.draft}';").stdout)

    def test_atomic_reservation_and_explicit_actor(self):
        result = self.result()
        self.assertTrue(result['ok'])
        self.assertEqual(result['uploadStatus'], 'waiting_for_authentication')
        row = json.loads(sql(f"select request from praktika_helper_jobs where id='{result['intentId']}';").stdout)
        self.assertEqual(row['actorUserId'], self.actor)
        self.assertNotEqual(row['actorUserId'], self.provider)
        self.assertEqual(self.count(), 1)

    def test_repeat_returns_same_intent(self):
        a, b = self.result(), self.result()
        self.assertEqual(a['intentId'], b['intentId'])
        self.assertTrue(b['reconciled'])
        self.assertEqual(self.count(), 1)

    def test_concurrent_starts(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.result(), range(8)))
        self.assertTrue(all(x['ok'] for x in results))
        self.assertEqual(len({x['intentId'] for x in results}), 1)
        self.assertEqual(self.count(), 1)

    def test_rollback(self):
        sql('begin;' + self.call() + 'rollback;')
        self.assertEqual(self.count(), 0)
        self.assertEqual(sql(f"select workflow_status is null from report_drafts where id='{self.draft}';").stdout.strip(), 't')

    def test_connection_interruption_rolls_back(self):
        # EOF with an open transaction simulates loss of the caller before COMMIT.
        sql('begin;' + self.call())
        self.assertEqual(self.count(), 0)
        self.assertEqual(sql(f"select workflow_status is null from report_drafts where id='{self.draft}';").stdout.strip(), 't')

    def test_failure_after_insert_rolls_back_both(self):
        sql("create function fail_workflow_fixture() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger fail_workflow_fixture before update on report_drafts for each row execute function fail_workflow_fixture();")
        try:
            self.assertNotEqual(sql(self.call(), check=False).returncode, 0)
            self.assertEqual(self.count(), 0)
            self.assertEqual(sql(f"select workflow_status is null from report_drafts where id='{self.draft}';").stdout.strip(), 't')
        finally:
            sql('drop trigger fail_workflow_fixture on report_drafts; drop function fail_workflow_fixture();')

    def test_historical_attempts_block_all_statuses(self):
        for status in ['pending', 'processing', 'running', 'failed', 'completed']:
            with self.subTest(status=status):
                row_id = str(uuid.uuid4())
                sql(f"insert into praktika_helper_jobs(id,job_type,status,request) values ('{row_id}','upload_report_to_praktika','{status}','{{\"reportDraftId\":\"{self.draft}\"}}');")
                self.assertEqual(self.result()['code'], 'existing_attempt')
                sql(f"delete from praktika_helper_jobs where id='{row_id}';")
        self.assertEqual(self.count(), 0)

    def test_actor_and_option_conflicts(self):
        self.result()
        self.assertEqual(self.result(actor=str(uuid.uuid4()))['code'], 'intent_conflict')
        self.assertEqual(self.result(options='{"attachPeriodontalChart":true}')['code'], 'intent_conflict')
        self.assertEqual(self.count(), 1)

    def test_actor_metadata_change_keeps_original_intent(self):
        first = self.result(options='{"actor":{"actorFullName":"synthetic-a"},"authorization":"fixture-one"}')
        second = self.result(options='{"actor":{"actorFullName":"synthetic-b"},"authorization":"fixture-two"}')
        self.assertEqual(first['intentId'], second['intentId'])
        self.assertTrue(second['reconciled'])
        self.assertEqual(self.count(), 1)

    def test_failed_intent_not_reset(self):
        first = self.result()
        sql(f"update praktika_helper_jobs set status='failed', attempts=1 where id='{first['intentId']}';")
        again = self.result()
        self.assertEqual(again['intentStatus'], 'failed')
        self.assertEqual(self.count(), 1)

    def test_ineligible_draft(self):
        sql(f"update report_drafts set status='draft' where id='{self.draft}';")
        self.assertEqual(self.result()['code'], 'ineligible_draft')
        self.assertEqual(self.count(), 0)

    def test_service_only_execute(self):
        self.assertEqual(sql("select has_function_privilege('anon','reserve_praktika_workflow(uuid,uuid,jsonb)','execute') or has_function_privilege('authenticated','reserve_praktika_workflow(uuid,uuid,jsonb)','execute');").stdout.strip(), 'f')
        self.assertEqual(sql("select has_function_privilege('service_role','reserve_praktika_workflow(uuid,uuid,jsonb)','execute');").stdout.strip(), 't')


if __name__ == '__main__':
    unittest.main(verbosity=2)
