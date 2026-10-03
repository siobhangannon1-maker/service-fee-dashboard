"""Synthetic migration tests in a new, Unix-socket-only PostgreSQL cluster.

Never reads database URLs or uses an existing cluster. Requires local PG 17 tools.
Run: python3 scripts/typist-edit-learning-db.test.py
"""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'supabase/migrations/20261003000000_typist_edit_learning_queue.sql'
PROVIDER = '00000000-0000-4000-8000-000000000001'
DRAFT = '00000000-0000-4000-8000-000000000002'
SOURCE = 'typist_existing_draft_approval'


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def analysis(keys=('plain_style',), reusable=True):
    return dict(reusable=reusable, ignore_reason=None, summary='Synthetic style evidence',
                behaviours=[dict(behaviour_key=k, category='style', knowledge_type='behaviour',
                                 behaviour_text='Use plain language.', preferred_phrase=None,
                                 template_block=None, applies_when=None,
                                 evidence_summary='Synthetic edit evidence.', confidence_delta=5)
                            for k in keys])


class QueueDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='typist-learning-db-')
        cls.path = Path(cls.temp.name)
        cls.pg = Path(os.environ.get('LOCAL_PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
        if not (cls.pg / 'initdb').exists():
            found = shutil.which('initdb')
            if not found:
                raise RuntimeError('Local PostgreSQL is required; no remote fallback is allowed')
            cls.pg = Path(found).resolve().parent
        cls.env = {'PATH': os.environ.get('PATH', ''), 'LANG': 'C', 'LC_ALL': 'C'}
        cls.user = __import__('getpass').getuser()
        cls.data = cls.path / 'cluster'
        subprocess.run([str(cls.pg / 'initdb'), '-D', str(cls.data), '-A', 'trust',
                        '--no-locale', '-E', 'UTF8', '-U', cls.user],
                       env=cls.env, check=True, capture_output=True)
        subprocess.run([str(cls.pg / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.path / 'server.log'),
                        '-o', f'-k {cls.path} -h "" -p 6543 -F', '-w', 'start'],
                       env=cls.env, check=True, capture_output=True)
        cls.addClassCleanup(cls.cleanup_cluster)
        cls.sql('''
          create role anon nologin;
          create role authenticated nologin;
          create role service_role nologin bypassrls;
          create table public.providers (id uuid primary key);
          create table public.report_drafts (id uuid primary key);
          create table public.provider_report_edit_examples (
            id uuid primary key default gen_random_uuid(),
            provider_id uuid references public.providers(id) on delete cascade,
            report_type text, original_text text, final_text text,
            created_from_draft_id uuid, created_at timestamptz default now(),
            report_draft_id uuid references public.report_drafts(id) on delete cascade,
            source text not null default 'approval_edit',
            updated_at timestamptz not null default now(), editor_role text,
            editor_id uuid, editor_name text, approved_by_provider boolean not null default false,
            analysis_status text not null default 'pending'
              check (analysis_status in ('pending','processing','processed','failed','ignored')),
            analysis_attempts integer not null default 0, analysis_error text,
            analysed_at timestamptz, analysis_json jsonb not null default '{}', edit_fingerprint text,
            check (editor_role is null or editor_role in ('provider','typist','admin','staff','unknown'))
          );
          create unique index provider_report_edit_examples_fingerprint_unique
            on public.provider_report_edit_examples(edit_fingerprint)
            where edit_fingerprint is not null;
          create table public.provider_behaviours (
            id uuid primary key default gen_random_uuid(), provider_id uuid not null,
            report_type text not null default 'all', behaviour_key text not null,
            category text not null default 'style', behaviour_text text not null,
            evidence_summary text, confidence integer not null default 50,
            support_count integer not null default 1, status text not null default 'active',
            source text not null default 'training_case', created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(), knowledge_type text not null default 'behaviour',
            preferred_phrase text, template_block text, applies_when text,
            unique(provider_id,report_type,behaviour_key)
          );
          alter table public.provider_report_edit_examples enable row level security;
          alter table public.provider_behaviours enable row level security;
          grant all on all tables in schema public to service_role;
        ''')
        cls.sql(MIGRATION.read_text())

    @classmethod
    def cleanup_cluster(cls):
        subprocess.run([str(cls.pg / 'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'],
                       env=cls.env, check=True, capture_output=True)
        cls.temp.cleanup()

    @classmethod
    def sql(cls, statement, fail=False):
        result = subprocess.run([str(cls.pg / 'psql'), '-X', '-w', '-h', str(cls.path),
                                 '-p', '6543', '-U', cls.user, '-d', 'postgres',
                                 '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', statement],
                                env=cls.env, capture_output=True, text=True)
        if fail:
            if result.returncode == 0:
                raise AssertionError('Expected SQL rejection')
            return ''
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    def setUp(self):
        self.sql('truncate public.provider_report_edit_examples, public.provider_behaviours, '
                 'public.report_drafts, public.providers cascade; '
                 f'insert into public.providers values ({quoted(PROVIDER)}); '
                 f'insert into public.report_drafts values ({quoted(DRAFT)});')

    def enqueue(self, enrolled=True, source=SOURCE, role='typist', fingerprint=None):
        identifier = str(uuid.uuid4())
        self.sql('insert into public.provider_report_edit_examples '
                 '(id,provider_id,report_draft_id,report_type,original_text,final_text,source,'
                 'editor_role,edit_fingerprint,next_attempt_at) values '
                 f'({quoted(identifier)},{quoted(PROVIDER)},{quoted(DRAFT)},'
                 f"'consultation_report','Synthetic draft','Synthetic edited draft',"
                 f'{quoted(source)},{quoted(role)},{quoted(fingerprint or identifier)},'
                 + ('now()' if enrolled else 'null') + ')')
        return identifier

    def claim(self, token=None):
        token = token or str(uuid.uuid4())
        data = self.sql(f'select row_to_json(e) from public.claim_typist_edit_learning({quoted(token)}) e')
        return json.loads(data) if data else None

    def finish(self, example, value=None, code=None, retry=False, fail=False):
        return self.sql('select public.finish_typist_edit_learning('
                        f'{quoted(example["id"])},{quoted(example["claim_token"])},'
                        + (quoted(json.dumps(value)) + '::jsonb' if value is not None else 'null')
                        + ',' + (quoted(code) if code else 'null')
                        + f',{str(retry).lower()})', fail=fail)

    def test_multiple_workers_claim_exclusivity_and_lease(self):
        self.enqueue()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            rows = list(pool.map(lambda _: self.claim(), range(8)))
        claimed = [row for row in rows if row]
        self.assertEqual(len(claimed), 1)
        row = claimed[0]
        self.assertEqual(row['analysis_attempts'], 1)
        self.assertEqual(self.sql(f"select round(extract(epoch from lease_expires_at-updated_at)) "
                                 f"from public.provider_report_edit_examples where id={quoted(row['id'])}"), '2700')

    def test_stale_claim_recovery_and_tokens(self):
        identifier = self.enqueue()
        old = self.claim()
        self.sql(f"update public.provider_report_edit_examples set lease_expires_at=now()-interval '1 second' "
                 f'where id={quoted(identifier)}')
        self.assertEqual(self.finish(old, analysis()), 'f')
        new = self.claim()
        self.assertEqual(new['id'], old['id'])
        self.assertEqual(new['analysis_attempts'], 2)
        self.assertNotEqual(new['claim_token'], old['claim_token'])
        self.assertEqual(self.finish(old, analysis()), 'f')
        self.assertEqual(self.finish(new, analysis()), 't')

    def test_retry_delays_and_three_attempt_exhaustion(self):
        identifier = self.enqueue()
        for attempt, delay in [(1, 60), (2, 300), (3, None)]:
            row = self.claim()
            self.assertEqual(row['analysis_attempts'], attempt)
            self.assertEqual(self.finish(row, code='learning_execution_failed', retry=True), 't')
            interval = self.sql(f'select round(extract(epoch from next_attempt_at-updated_at)) '
                                f'from public.provider_report_edit_examples where id={quoted(identifier)}')
            self.assertEqual(interval, str(delay) if delay else '')
            self.assertIsNone(self.claim())
            if delay:
                self.sql(f'update public.provider_report_edit_examples set next_attempt_at=now() '
                         f'where id={quoted(identifier)}')

    def test_exhausted_crash_becomes_terminal(self):
        identifier = self.enqueue()
        for attempt in range(1, 4):
            row = self.claim()
            self.assertEqual(row['analysis_attempts'], attempt)
            self.sql(f"update public.provider_report_edit_examples set lease_expires_at=now()-interval '1 second' "
                     f'where id={quoted(identifier)}')
        self.assertIsNone(self.claim())
        self.assertEqual(self.sql(f"select analysis_status||':'||analysis_error from "
                                 f'public.provider_report_edit_examples where id={quoted(identifier)}'),
                         'failed:worker_lease_expired')

    def test_permanent_failure_and_legacy_isolation(self):
        self.enqueue(enrolled=False)
        self.enqueue(source='provider_existing_draft_approval')
        self.enqueue(source='clinical_scribe_letter_approval')
        identifier = self.enqueue()
        row = self.claim()
        self.assertEqual(row['id'], identifier)
        self.assertEqual(self.finish(row, code='invalid_saved_input', retry=False), 't')
        self.assertIsNone(self.claim())

    def test_atomic_rollback_on_late_behaviour_failure(self):
        self.enqueue()
        row = self.claim()
        # A DB failure on behaviour two proves behaviour one also rolls back.
        self.sql("alter table public.provider_behaviours add constraint synthetic_failure "
                 "check (behaviour_key <> 'second')")
        try:
            self.finish(row, analysis(('first', 'second')), fail=True)
            self.assertEqual(self.sql('select count(*) from public.provider_behaviours'), '0')
            self.assertEqual(self.sql(f'select analysis_status from public.provider_report_edit_examples '
                                     f'where id={quoted(row["id"])}'), 'processing')
        finally:
            self.sql('alter table public.provider_behaviours drop constraint synthetic_failure')
        self.assertEqual(self.finish(row, analysis()), 't')

    def test_lost_acknowledgement_and_processed_ignored_do_not_reopen(self):
        self.enqueue()
        row = self.claim()
        self.assertEqual(self.finish(row, analysis()), 't')
        self.assertEqual(self.finish(row, analysis()), 'f')
        self.assertEqual(self.sql('select support_count from public.provider_behaviours'), '1')
        self.assertIsNone(self.claim())
        self.enqueue()
        ignored = self.claim()
        self.assertEqual(self.finish(ignored, analysis((), False)), 't')
        self.assertEqual(self.finish(ignored, analysis()), 'f')
        self.assertIsNone(self.claim())

    def test_delete_during_analysis_does_not_recreate(self):
        self.enqueue()
        row = self.claim()
        self.sql(f'delete from public.report_drafts where id={quoted(DRAFT)}')
        self.assertEqual(self.finish(row, analysis()), 'f')
        self.assertEqual(self.sql('select count(*) from public.provider_report_edit_examples'), '0')
        self.assertEqual(self.sql('select count(*) from public.provider_behaviours'), '0')

    def test_normalized_analysis_validation(self):
        self.enqueue()
        row = self.claim()
        for value in [{}, analysis(tuple('k'+str(i) for i in range(6))),
                      {**analysis(), 'reusable': 'true'}]:
            self.finish(row, value, fail=True)
        value = analysis()
        value['behaviours'][0]['confidence_delta'] = 6
        self.finish(row, value, fail=True)
        self.assertEqual(self.sql('select count(*) from public.provider_behaviours'), '0')

    def test_confidence_weighting_and_reinforcement_parity(self):
        # Golden cases from the unchanged synchronous calculation.
        for role, weight in [('provider', 12), ('admin', 9), ('typist', 6), ('staff', 4), ('unknown', 3)]:
            for delta in range(1, 6):
                key = role + '_' + str(delta)
                self.enqueue(role=role)
                row = self.claim()
                value = analysis((key,))
                value['behaviours'][0]['confidence_delta'] = delta
                expected = max(1, int(weight * delta / 5 + .5))
                self.finish(row, value)
                self.assertEqual(self.sql(f'select confidence||\':\'||support_count from public.provider_behaviours '
                                         f'where behaviour_key={quoted(key)}'), f'{45+expected}:1')
                self.enqueue(role=role)
                self.finish(self.claim(), value)
                self.assertEqual(self.sql(f'select confidence||\':\'||support_count from public.provider_behaviours '
                                         f'where behaviour_key={quoted(key)}'), f'{45+2*expected}:2')

    def test_concurrent_different_examples_increment_without_loss(self):
        for _ in range(6):
            self.enqueue()
        rows = [self.claim() for _ in range(6)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            outcomes = list(pool.map(lambda row: self.finish(row, analysis()), rows))
        self.assertEqual(outcomes, ['t'] * 6)
        self.assertEqual(self.sql('select confidence||\':\'||support_count from public.provider_behaviours'), '81:6')

    def test_reinforcement_caps_fallbacks_metadata_and_unicode_trim_parity(self):
        for confidence, expected in [(0, 56), (99, 100)]:
            self.sql('truncate public.provider_behaviours')
            self.sql('insert into public.provider_behaviours '
                     '(provider_id,report_type,behaviour_key,behaviour_text,confidence,support_count,evidence_summary) '
                     f"values ({quoted(PROVIDER)},'consultation_report','plain_style','Old style',{confidence},0,"
                     + quoted('\u00a0\nPrior evidence\n\u3000') + ')')
            self.enqueue()
            self.finish(self.claim(), analysis())
            self.assertEqual(self.sql('select confidence||\':\'||support_count from public.provider_behaviours'), f'{expected}:2')
            self.assertEqual(self.sql('select evidence_summary from public.provider_behaviours'),
                             'Prior evidence | Synthetic edit evidence.')

    def test_fingerprint_conflict_does_not_change_snapshot_or_terminal_state(self):
        identifier = self.enqueue(fingerprint='same_fingerprint')
        self.finish(self.claim(), analysis())
        self.sql("insert into public.provider_report_edit_examples "
                 "(original_text,final_text,edit_fingerprint,next_attempt_at) "
                 "values ('Different','Different final','same_fingerprint',now()) "
                 "on conflict (edit_fingerprint) where edit_fingerprint is not null do nothing")
        self.assertEqual(self.sql('select count(*) from public.provider_report_edit_examples'), '1')
        self.assertEqual(self.sql(f"select analysis_status||':'||original_text from "
                                 f'public.provider_report_edit_examples where id={quoted(identifier)}'),
                         'processed:Synthetic draft')
        self.assertIsNone(self.claim())

    def test_rpc_privileges_and_service_role(self):
        for role in ['anon', 'authenticated']:
            self.sql(f'set role {role}; select public.claim_typist_edit_learning(gen_random_uuid())', fail=True)
            self.sql(f'set role {role}; select public.finish_typist_edit_learning('
                     'gen_random_uuid(),gen_random_uuid(),null,null,false)', fail=True)
        self.enqueue()
        result = self.sql('set role service_role; select count(*) from '
                          'public.claim_typist_edit_learning(gen_random_uuid())')
        self.assertEqual(result, '1')

    def test_normalized_metadata_and_knowledge_types_are_applied_unchanged(self):
        for knowledge in ['behaviour', 'preferred_phrase', 'template_block']:
            self.enqueue()
            value = analysis((knowledge,))
            b = value['behaviours'][0]
            b.update(category='formatting', knowledge_type=knowledge,
                     preferred_phrase='Synthetic phrase' if knowledge == 'preferred_phrase' else None,
                     template_block='Synthetic template' if knowledge == 'template_block' else None,
                     applies_when='Synthetic context')
            self.finish(self.claim(), value)
            actual = json.loads(self.sql('select row_to_json(b) from public.provider_behaviours b '
                                         f'where behaviour_key={quoted(knowledge)}'))
            for field in ['behaviour_key', 'category', 'knowledge_type', 'behaviour_text',
                          'preferred_phrase', 'template_block', 'applies_when', 'evidence_summary']:
                self.assertEqual(actual[field], b[field])
            self.assertEqual(actual['source'], 'approved_edit_learning')
            self.assertEqual(actual['status'], 'active')


if __name__ == '__main__':
    unittest.main(verbosity=2)
