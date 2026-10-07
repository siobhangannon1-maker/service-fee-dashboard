"""Compare the same JSON cases through shipped TS and SQL, in disposable PG17.
No review-only predicates, credentials, or external workflows.
"""
import importlib.util,pathlib,sys,json,subprocess,unittest,os,uuid
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('resolution_fixture',ROOT/'scripts/workflow-resolution-db.test.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t);b=t.b
class Parity(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  t.Tests.setUpClass()
  cls.data=json.loads(subprocess.check_output(['node','--import','tsx','lib/report-writing/production-evidence-parity-fixtures.ts','--emit'],cwd=ROOT,text=True))
 def test_shipped_predicates_on_identical_json_cases(self):
  rows=self.data['cases'];values=','.join(f"({i},{b.literal(row['job'])})" for i,row in enumerate(rows))
  actual=json.loads(b.sql("select jsonb_agg(jsonb_build_object('index',i,'read',workflow_resolution_periodontal_read(j),'settled',workflow_resolution_legacy_execution_safe(j),'responseConflict',workflow_resolution_execution_conflict(j->'response'),'resultConflict',workflow_resolution_execution_conflict(j->'result'),'responseContainer',workflow_resolution_response_container(j->'response'),'resultContainer',workflow_resolution_response_container(j->'result')) order by i) from (values "+values+") c(i,j);"))
  mismatches=[dict(name=rows[x['index']]['name'],job=rows[x['index']]['job'],expected=rows[x['index']]['expected'],actual={k:v for k,v in x.items() if k!='index'}) for x in actual if rows[x['index']]['expected']!={k:v for k,v in x.items() if k!='index'}]
  ids=self.data['ids'];v=','.join(f"({i},{b.literal(x['value'])})" for i,x in enumerate(ids))
  idactual=json.loads(b.sql('select jsonb_agg(workflow_resolution_positive_read_id(v) order by i) from (values '+v+') c(i,v);'))
  mismatches.extend(dict(id=ids[i]['value'],expected=ids[i]['expected'],actual=a) for i,a in enumerate(idactual) if a!=ids[i]['expected'])
  out={'job_shapes':len(rows),'identifier_boundaries':len(ids),'boolean_comparisons':len(rows)*6+len(ids),'mismatches':mismatches,'method':'Identical JSON input; shipped TS exports versus shipped SQL functions; no normalization in the comparison harness.'}
  path=pathlib.Path(os.environ.get('RESOLVE_PARITY_OUTPUT',str(ROOT.parent/'expanded-parity-evidence.json')));path.write_text(json.dumps(out,indent=2)+'\n')
  self.assertEqual(mismatches,[],str(mismatches[:10]))
 def test_association_and_queued_send_snapshot_parity(self):
  cases=[]
  for name in ['parent-only','scoped-upload','scoped-upload-uncertain','unscoped-unrelated-active','unscoped-unrelated-failed',
    'queued-missing','queued-prepared','queued-sent','queued-uncertain','queued-wrong-draft','conflicting-target']:
   f=t.Tests('runTest');f.setUp();job=str(uuid.uuid4());other=str(uuid.uuid4())
   if name in ['queued-wrong-draft','conflicting-target']:
    b.sql(f"insert into report_drafts select * from jsonb_populate_record(null::report_drafts,(select to_jsonb(d)||jsonb_build_object('id','{other}') from report_drafts d where id='{f.d}'));")
   if name.startswith('scoped-upload') or name.startswith('unscoped-unrelated') or name=='conflicting-target':
    q=dict(reportDraftId=f.d) if name.startswith('scoped') else {}
    if name=='conflicting-target':q=dict(reportDraftId=other,continuationId=f.parent)
    response=dict(patient_communication=dict(iFileId=42))
    if name.endswith('uncertain'):response['nested']=[dict(externalExecution='uncertain')]
    b.insert('praktika_helper_jobs',dict(id=job,job_type='upload_report_to_praktika',status='processing' if name.endswith('active') else 'failed' if name.endswith('failed') else 'completed',request=q,response=response))
   if name.startswith('queued'):
    if name!='queued-missing':
     result=dict(prepared=True,sent=False) if name=='queued-prepared' else dict(sent=True)
     if name=='queued-uncertain':result['rows']=[dict(externalExecution='uncertain')]
     b.insert('mediref_helper_jobs',dict(id=job,job_type='send_mediref_letter',status='completed',payload=dict(draftId=other if name=='queued-wrong-draft' else f.d),result=result))
    b.insert('report_writing_audit_events',dict(id=str(uuid.uuid4()),entity_type='report_draft',entity_id=f.d,action='Queued MediRef send',details=dict(jobId=job)))
   snapshot=f.snapshot()
   cases.append(dict(name=name,draftId=f.d,jobs=snapshot['praktika']+snapshot['mediref'],events=snapshot['events'],sql=snapshot['executionSafe']))
  inputfile=ROOT.parent/'snapshot-parity-input.json';inputfile.write_text(json.dumps(cases))
  code="const fs=require('node:fs');const {productionExecutionSafe}=require('./lib/report-writing/production-evidence.ts');const rows=JSON.parse(fs.readFileSync(process.argv[1]));console.log(JSON.stringify(rows.map(r=>({...r,ts:productionExecutionSafe(r.draftId,r.jobs,r.events)}))));"
  rows=json.loads(subprocess.check_output(['node','--import','tsx','-e',code,str(inputfile)],cwd=ROOT,text=True))
  mismatches=[r['name'] for r in rows if r['ts']!=r['sql']]
  evidence=dict(cases=[dict(name=r['name'],typescript=r['ts'],sql=r['sql']) for r in rows],mismatches=mismatches)
  (ROOT.parent/'association-audit-parity-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
  self.assertEqual(mismatches,[])
if __name__=='__main__':
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER,'-A','trust','-U','postgres','--no-locale','-E','UTF8']);assert r.returncode==0,r.stderr
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert r.returncode==0,r.stderr
 try:unittest.main(verbosity=2)
 finally:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER,'-m','fast','-w','stop'])
