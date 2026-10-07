"""Exact old/new SQL snapshot and candidate equivalence; synthetic PG17 only."""
import pathlib,importlib.util,sys,json,uuid,unittest,time,re
sys.dont_write_bytecode=True
R=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('resolution',R/'scripts/workflow-resolution-db.test.py');t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t);b=t.b
class Snapshot(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  t.Tests.setUpClass()
  source=(R/'supabase/migrations/20261006061315_workflow_resolution_production_evidence.sql').read_text()
  safe=source[source.index('create or replace function public.workflow_resolution_legacy_draft_safe'):source.index('create or replace function public.workflow_resolution_snapshot')]
  snap=source[source.index('create or replace function public.workflow_resolution_snapshot'):source.index('create or replace function public.verify_workflow_completion')]
  b.sql(safe.replace('public.workflow_resolution_legacy_draft_safe','public.baseline_resolution_legacy_draft_safe')+snap.replace('public.workflow_resolution_snapshot','public.baseline_resolution_snapshot').replace('public.workflow_resolution_legacy_draft_safe','public.baseline_resolution_legacy_draft_safe'))
 def fixture(self):
  f=t.Tests('runTest');f.setUp();return f
 def same(self,f):
  old=json.loads(b.sql(f"select baseline_resolution_snapshot('{f.d}','{f.actor}');"));new=f.snapshot();self.assertEqual(old,new)
  ids=json.loads(b.sql(f"select jsonb_build_object('old',(select coalesce(jsonb_agg(id order by id),'[]') from praktika_helper_jobs j where workflow_resolution_job_associated(to_jsonb(j),'{f.d}')),'new',(select coalesce(jsonb_agg(id order by id),'[]') from workflow_resolution_praktika_jobs('{f.d}')));"));self.assertEqual(ids['old'],ids['new']);return new
 def test_all_association_paths_and_contradictions(self):
  f=self.fixture();other=str(uuid.uuid4())
  # Import malformed historical equivalents before applying current insertion guards.
  b.sql('alter table praktika_helper_jobs disable trigger user;')
  for q,kind in [(dict(reportDraftId=f.d.upper()),'other'),(dict(continuationId=f.parent),'other'),(dict(reportDraftId=other,continuationId=f.parent),'other'),(dict(body=dict(file=dict(path=f'report-uploads/operator/{f.d}/letter.pdf'))),'upload_report_to_praktika'),(dict(body=dict(file=dict(path=f'wrong/operator/{f.d}/letter.pdf'))),'upload_report_to_praktika'),({},'other')]:
   b.insert('praktika_helper_jobs',dict(id=str(uuid.uuid4()),job_type=kind,status='failed',request=q))
  child=b.sql(f"select substr(encode(sha256(convert_to('praktika-continuation-child:v1','UTF8')||decode('00','hex')||convert_to('{f.parent}','UTF8')||decode('00','hex')||convert_to('update_praktika_letter_icons','UTF8')),'hex'),1,32)::uuid;")
  b.insert('praktika_helper_jobs',dict(id=child,job_type='update_praktika_letter_icons',status='failed',request={}))
  b.sql('alter table praktika_helper_jobs enable trigger user;')
  self.assertFalse(self.same(f)['executionSafe'])
 def test_legacy_icon_exact_and_ambiguous(self):
  f=self.fixture();stamp='2026-10-01T12:00:00Z';receipt=dict(appointment_icon1id=6597,appointment_icon2id=0,appointment_icon3id=0,appointment_icon4id=0)
  b.sql(f"update report_drafts set praktika_letter_icon_appointment_id='42',praktika_letter_icon_updated_at='{stamp}',praktika_letter_icon_update_response_preview={b.literal(receipt)}::text where id='{f.d}';")
  b.insert('praktika_helper_jobs',dict(id=str(uuid.uuid4()),app_user_id=f.actor,job_type='upload_report_to_praktika',status='completed',request=dict(reportDraftId=f.d),response=dict(patient_communication=dict(iFileId=42))))
  icon=str(uuid.uuid4());b.insert('praktika_helper_jobs',dict(id=icon,app_user_id=f.actor,job_type='update_praktika_letter_icons',status='completed',completed_at=stamp,request=dict(body=[dict(appointment_id='42')]),response=receipt))
  # A large same-appointment legacy history must still be filtered by exact receipts.
  b.sql("alter table praktika_helper_jobs disable trigger user; insert into praktika_helper_jobs(id,job_type,status,request,response) select md5('legacy-receipt:'||g)::uuid,'update_praktika_letter_icons','completed','{\"body\":[{\"appointment_id\":\"42\"}]}'::jsonb,'{}' from generate_series(1,2000) g; alter table praktika_helper_jobs enable trigger user; analyze praktika_helper_jobs;")
  self.same(f)
  plan=json.loads(b.sql(f"explain (analyze,buffers,format json) select workflow_resolution_snapshot('{f.d}','{f.actor}');"))[0]
  self.assertLess(plan['Execution Time'],1000)
  (R.parent/'resolve-snapshot-large-legacy-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
  other=str(uuid.uuid4());b.sql(f"insert into report_drafts select * from jsonb_populate_record(null::report_drafts,(select to_jsonb(d)||jsonb_build_object('id','{other}') from report_drafts d where id='{f.d}'));")
  s=self.same(f);self.assertNotIn(icon,[j['id'] for j in s['praktika']])
 def test_production_size_histories_and_parentless_shalee_shape(self):
  f=self.fixture()
  b.sql("alter table praktika_helper_jobs disable trigger user; insert into praktika_helper_jobs(id,job_type,status,request,response) select md5('synthetic-history:'||g)::uuid,case when g%5=0 then 'update_praktika_letter_icons' else 'report_writing_latest_referral' end,'completed',jsonb_build_object('body',jsonb_build_array(jsonb_build_object('appointment_id',g::text)),'synthetic',repeat('x',512)), '{}' from generate_series(1,100837) g; alter table praktika_helper_jobs enable trigger user; analyze praktika_helper_jobs;")
  evidence=[]
  for name in ['canonical-safe','uncertain','parentless-shalee','no-helpers']:
   if name=='uncertain':f.replace_response(dict(externalExecution='uncertain'))
   if name=='parentless-shalee':
    b.sql(f"delete from praktika_helper_jobs where id='{f.parent}'; update report_drafts set status='uploaded_to_praktika',workflow_status=null,workflow_periodontal_chart_status=null,workflow_mediref_status=null,workflow_icon_update_status='running',uploaded_to_praktika=true where id='{f.d}';")
    b.insert('praktika_helper_jobs',dict(id=str(uuid.uuid4()),app_user_id=f.actor,job_type='upload_report_to_praktika',status='completed',locked_by='historic',request=dict(reportDraftId=f.d),response=dict(patient_communication=dict(iFileId=42))))
   oldplan=json.loads(b.sql(f"explain (analyze,buffers,format json) select baseline_resolution_snapshot('{f.d}','{f.actor}');"))[0]
   newplan=json.loads(b.sql(f"explain (analyze,buffers,format json) select workflow_resolution_snapshot('{f.d}','{f.actor}');"))[0]
   self.same(f);self.assertLess(newplan['Execution Time'],1000)
   evidence.append(dict(case=name,before=oldplan,after=newplan))
   if name=='parentless-shalee':self.assertFalse(f.snapshot()['executionSafe'])
   if name=='no-helpers':break
   if name=='parentless-shalee':f=self.fixture();b.sql(f"delete from praktika_helper_jobs where id='{f.parent}';")
  (R.parent/'resolve-snapshot-performance-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
if __name__=='__main__':
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert r.returncode==0,r.stderr
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert r.returncode==0,r.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
