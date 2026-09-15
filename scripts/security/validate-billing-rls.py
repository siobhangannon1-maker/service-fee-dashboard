#!/usr/bin/env python3
"""Disposable local PostgreSQL only. Never reads .env or accepts a remote DSN."""
from pathlib import Path
import os, subprocess, tempfile, json
ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@17/bin')
ENV = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
passed = 0
with tempfile.TemporaryDirectory(prefix='billing-rls-', dir='/private/tmp') as tmp:
    tmp = Path(tmp)
    def command(args):
        return subprocess.run([str(a) for a in args], env=ENV, text=True, capture_output=True)
    r=command([BIN/'initdb','-D',tmp/'data','-U','postgres','--auth=trust','--no-locale'])
    if r.returncode: raise RuntimeError(r.stderr)
    r=command([BIN/'pg_ctl','-D',tmp/'data','-l',tmp/'server.log','-o',f"-k {tmp} -c listen_addresses=''",'-w','start'])
    if r.returncode: raise RuntimeError(r.stderr)
    try:
        def sql(body, ok=True, error=None):
            r=subprocess.run([str(BIN/'psql'),'-X','-h',str(tmp),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq'], input=body,text=True,capture_output=True,env=ENV)
            if ok and r.returncode: raise AssertionError(r.stderr)
            if not ok and (not r.returncode or error and error not in r.stderr): raise AssertionError('Expected rejection '+str(error)+'; '+r.stderr)
            return r.stdout.strip()
        def check(name, body, expected=None, denied=False, role=None, user=1):
            global passed
            prefix='begin;'
            if role: prefix+=f"set local role {role}; set local request.jwt.claim.sub='00000000-0000-4000-8000-{user:012d}';"
            result=sql(prefix+body+';rollback;',ok=not denied,error='42501' if denied else None)
            if expected is not None and result!=str(expected): raise AssertionError(name+': '+repr(result)+' != '+repr(expected))
            passed+=1;print('PASS',name,flush=True)
        tables=['imports','import_rows_raw','import_rows_normalized','billing_period_imports','patient_financial_entries','billing_detail_entries','user_roles','user_status']
        sql("""
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create type app_role as enum ('admin','super_admin','staff','billing_staff','practice_manager','typist','provider_readonly');
create table user_roles(user_id uuid,role app_role,created_at timestamptz default now());
create table user_status(user_id uuid,is_active boolean,updated_at timestamptz default now());
create table imports(id uuid primary key default gen_random_uuid(),request jsonb);
create table import_rows_raw(like imports including all);
create table import_rows_normalized(like imports including all);
create table billing_period_imports(like imports including all);
create table patient_financial_entries(id uuid primary key default gen_random_uuid(),provider_id uuid,related_provider_id uuid,billing_period_id uuid,patient_name text,entry_date date,category text,amount numeric,notes text,deleted_at timestamptz,deleted_by uuid,is_review_locked boolean default false,is_verified boolean default false,verified_at timestamptz,verified_by uuid,verified_by_initials text,created_by uuid default auth.uid());
create table billing_detail_entries(like patient_financial_entries including all);
grant all on all tables in schema public to anon,authenticated,service_role;
""")
        for table in ['patient_financial_entries','billing_detail_entries','user_roles','user_status']:
            sql(f'alter table {table} enable row level security;')
        for table in ['patient_financial_entries','billing_detail_entries']:
            sql(f'create policy legacy_allow on {table} for all to authenticated using (true) with check(true);create policy duplicate_read on {table} for select to authenticated using(true);')
        for i,role in enumerate(['admin','super_admin','staff','billing_staff','practice_manager','typist','provider_readonly','admin','admin','admin','admin'],1):
            sql(f"insert into user_roles values ('00000000-0000-4000-8000-{i:012d}','{role}',now());")
            if i!=9: sql(f"insert into user_status values ('00000000-0000-4000-8000-{i:012d}',{'false' if i==8 else 'null' if i==10 else 'true'},now());")
        sql("insert into user_status select * from user_status where user_id='00000000-0000-4000-8000-000000000011';")
        for table in tables[:6]: sql(f"insert into {table}(id) values ('10000000-0000-4000-8000-000000000001');")
        baseline=sql((ROOT/'docs/security/batch2/capture-rollback.sql').read_text())
        migration=(ROOT/'docs/security/batch2/proposed-migration.sql').read_text()
        sql(migration,ok=False,error='Review aggregate')
        check('unacknowledged migration rolls back helper creation',"select to_regprocedure('public.billing_access_level_v1()') is null",'t')
        migration=migration.replace('begin;',"begin;set local billing_v1.preflight_reviewed='yes';set local billing_v1.canonical_billing_reviewed='yes';",1)
        # Residual PUBLIC/inherited/column SELECT must abort the whole migration.
        for table in ['user_roles','user_status']:
            for grant,revoke in [
                (f'grant select on {table} to public',f'revoke select on {table} from public'),
                (f'grant select(user_id) on {table} to public',f'revoke select(user_id) on {table} from public'),
            ]:
                sql(grant)
                sql(migration,ok=False,error='Permission sources remain anonymously readable')
                check('residual SELECT rollback '+table,"select to_regprocedure('public.billing_access_level_v1()') is null",'t')
                sql(revoke)
        sql(migration);passed+=1;print('PASS migration applies',flush=True)
        for table in ['user_roles','user_status']:
            check('anon source SELECT privilege '+table,f"select has_table_privilege('anon','{table}','SELECT')",'f')
            check('anon source column SELECT '+table,f"select has_any_column_privilege('anon','{table}','SELECT')",'f')
            check('anon source read denied '+table,f'select * from {table}',denied=True,role='anon')
            check('authenticated source SELECT preserved '+table,f"select has_table_privilege('authenticated','{table}','SELECT')",'t')
        sql(migration,ok=False,error='already applied');passed+=1;print('PASS exact rerun refuses safely',flush=True)
        for t in tables[:6]:
            for op in ['select * from','insert into','update','delete from','truncate']:
                stmt= {'select * from':f'select * from {t}', 'insert into':f'insert into {t} default values','update':f'update {t} set id=id','delete from':f'delete from {t}','truncate':f'truncate {t}'}[op]
                check('anon '+op+' '+t,stmt,denied=True,role='anon')
        check('anon helper denied','select billing_access_level_v1()',denied=True,role='anon')
        for uid in range(1,12): check('eligibility user '+str(uid),'select billing_access_level_v1()',2 if uid in [1,2] else 1 if uid in [3,4,5] else 0,role='authenticated',user=uid)
        for uid in [6,7,8,9,10,11]:
            for t in ['patient_financial_entries','billing_detail_entries']:
                check(f'denied user {uid} read {t}',f'select count(*) from {t}',0,role='authenticated',user=uid)
                check(f'denied user {uid} insert {t}',f"insert into {t}(notes) values ('synthetic')",denied=True,role='authenticated',user=uid)
        for uid in range(1,8): check('links user '+str(uid),'select count(*) from billing_period_imports',1 if uid in [1,2] else 0,role='authenticated',user=uid)
        for t in tables[:4]:
            for statement in [f'update {t} set id=id',f'delete from {t}',f'truncate {t}']:
                check('browser write blocked '+statement,statement,denied=True,role='authenticated')
        for t in tables[:3]:
            check('server only select '+t,f'select * from {t}',denied=True,role='authenticated')
            check('server only insert '+t,f'insert into {t} default values',denied=True,role='authenticated')
        for t in ['patient_financial_entries','billing_detail_entries']:
            for uid in range(1,6):
                check(f'authorized read {uid} {t}',f'select count(*) from {t}',1,role='authenticated',user=uid)
                check(f'authorized insert {uid} {t}',f"with r as (insert into {t}(notes) values ('fixture') returning id) select count(*) from r",1,role='authenticated',user=uid)
                check(f'authorized update {uid} {t}',f"with r as (update {t} set notes='fixture' returning id) select count(*) from r",1,role='authenticated',user=uid)
            check('hard delete '+t,f'delete from {t}',denied=True,role='authenticated')
            check('wrong deletion actor '+t,f"update {t} set deleted_at=now(),deleted_by='00000000-0000-4000-8000-000000000002'",denied=True,role='authenticated')
            check('soft delete once '+t,f"with r as (update {t} set deleted_at=now(),deleted_by=auth.uid() returning id) select count(*) from r",1,role='authenticated')
            sql(f"update {t} set deleted_at=now(),deleted_by='00000000-0000-4000-8000-000000000001';")
            for patch in ['deleted_at=null,deleted_by=null',"notes='changed'",'deleted_at=now()',"deleted_by='00000000-0000-4000-8000-000000000002'"]:
                check('deleted immutable '+t+' '+patch,f'with r as (update {t} set {patch} returning id) select count(*) from r',0,role='authenticated')
        sql('update patient_financial_entries set deleted_at=null,deleted_by=null,is_review_locked=true;')
        check('review locked row cannot edit',"with r as (update patient_financial_entries set notes='changed' returning id) select count(*) from r",0,role='authenticated')
        for column,value in [('is_review_locked','false'),('is_verified','false'),('verified_at','null'),('verified_by','null'),('verified_by_initials',"'XX'")]:
            check('protected column update '+column,f'update patient_financial_entries set {column}={value}',denied=True,role='authenticated')
            check('protected column insert '+column,f'insert into patient_financial_entries({column}) values ({value})',denied=True,role='authenticated')
        for t in tables:
            for op in ['SELECT','INSERT','UPDATE','DELETE']:
                check('service privilege '+t+' '+op,f"select has_table_privilege(current_user,'{t}','{op}')",'t',role='service_role')
        for t in tables[:6]:
            check('service actual CRUD '+t,f"insert into {t}(id) values('20000000-0000-4000-8000-000000000001');update {t} set id=id;delete from {t} where id='20000000-0000-4000-8000-000000000001';select count(*) from {t}",1,role='service_role')
        for t in ['user_roles','user_status']:
            check('service identity CRUD '+t,f"insert into {t}(user_id) values('20000000-0000-4000-8000-000000000001');update {t} set user_id=user_id;delete from {t} where user_id='20000000-0000-4000-8000-000000000001';select count(*)>0 from {t}",'t',role='service_role')
            check('permission source mutation '+t,f'delete from {t}',denied=True,role='authenticated')
        # Captured first output is metadata; remaining lines are ordered restore SQL.
        restore=baseline[baseline.index('begin;'):]
        sql(restore,ok=False,error='Unsafe historical')
        restore=restore.replace('begin;',"begin;set local billing_v1.allow_unsafe_restore='yes';",1)
        sql(restore);passed+=1;print('PASS isolated historical restore',flush=True)
        check('historical RLS restored','select relrowsecurity from pg_class where oid=\'imports\'::regclass','f')
        check('historical grants restored',"select has_table_privilege('anon','imports','SELECT')",'t')
        restored=sql((ROOT/'docs/security/batch2/capture-rollback.sql').read_text())
        before=json.loads(baseline.splitlines()[0]);after=json.loads(restored.splitlines()[0])
        before.pop('captured_at');after.pop('captured_at')
        # ACL entries/policies are unordered sets; GRANT can change catalog order.
        def canonical(value):
            if isinstance(value,dict): return {k:canonical(v) for k,v in value.items()}
            if isinstance(value,list): return sorted((canonical(v) for v in value),key=lambda v:json.dumps(v,sort_keys=True))
            return value
        assert canonical(before)==canonical(after), 'Baseline metadata differs after rollback (excluding array order)'
        passed+=1;print('PASS complete captured baseline equality after rollback',flush=True)
        print('TOTAL PASS',passed,flush=True)
    finally:
        r=command([BIN/'pg_ctl','-D',tmp/'data','-m','fast','-w','stop'])
        if r.returncode: raise RuntimeError('Could not stop isolated database')
