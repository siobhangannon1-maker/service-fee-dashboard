"""Optional private frozen STRUCTURAL fixture replay; no network/application env.
Usage: python3 scripts/historical-reconciliation-frozen-db.py /private/tmp/phase1-frozen.json /private/tmp/phase1-approvals.json /private/tmp/phase1-manifest.json
Prints aggregate counts only. Uses its own disposable PostgreSQL cluster.
"""
import importlib.util,pathlib,sys,json,uuid
spec=importlib.util.spec_from_file_location('dbtest',pathlib.Path(__file__).with_name('historical-reconciliation-db.test.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
frozen=json.loads(pathlib.Path(sys.argv[1]).read_text());approvals={x['id']:x['provider_approved_at'] for x in json.loads(pathlib.Path(sys.argv[2]).read_text())};expected=json.loads(pathlib.Path(sys.argv[3]).read_text())
struct={r['id']:r for r in frozen['structural']};drafts={};pj={};mj={};audits={};excluded=set()
for row in frozen['base']:
 d=dict(row['d']);h=struct[d['id']]
 if d.get('auditExcluded'):excluded.add(d['id'])
 d.update(provider_id=d.get('providerId'),created_at=d.get('auditCreated'),updated_at=d.get('auditUpdated'),provider_approved_at=approvals.get(d['id']),
  patient_name='test test' if d.get('auditExcluded') else 'Synthetic Frozen Fixture',praktika_patient_id=h['patient'],praktika_letter_icon_appointment_id=h['appointment'],
  praktika_letter_icon_updated_at=h['icon_time'],praktika_letter_icon_update_response_preview=h['preview'])
 drafts[d['id']]=d
 for j in row['pj']+h['uploads']+h['icons']:pj[j['id']]=j
 for j in row['mj']:mj[j['id']]=j
 for a in h['audits']:
  audits[a['id']]={**a,'details':{'helperJobId':a['helperJobId'],'stagedPdf':{'storagePath':a['storagePath'],'bucket':a['bucket'],'fileName':a['fileName'],'contentType':a['contentType']},'praktikaPatientId':a['patientId'],'actorUserId':a['actorUserId']}}
 if h.get('duplicate_icon_audits',0):
  stub={'id':str(uuid.uuid4()),'praktika_letter_icon_appointment_id':h['appointment'],'praktika_letter_icon_updated_at':h['icon_time']};drafts[stub['id']]=stub
started=False
try:
 r=b.cmd([b.BIN/'initdb','-D',b.CLUSTER/'data','-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);assert not r.returncode
 r=b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER/'data','-l',b.CLUSTER/'server.log','-o',f"-k {b.CLUSTER} -p 65438 -c listen_addresses=''",'-w','start']);assert not r.returncode;started=True
 b.sql(b.SCHEMA)
 for table,rows in [('report_drafts',drafts),('praktika_helper_jobs',pj),('mediref_helper_jobs',mj),('report_writing_audit_events',audits)]:
  for row in rows.values():
   for key in ['id','app_user_id','provider_id','created_by','session_id']:
    if row.get(key):
     try: uuid.UUID(row[key])
     except ValueError: row[key]=str(uuid.uuid5(uuid.NAMESPACE_URL,'frozen:'+row[key]))
  b.sql(f'insert into {table} select * from jsonb_populate_recordset(null::{table},{b.literal(list(rows.values()))});')
 b.sql(b.MIGRATION.read_text())
 data=json.loads(b.sql("select jsonb_agg(jsonb_build_object('id',id,'result',public.inspect_historical_workflow(id))) from report_drafts where status in ('approved','uploaded_to_praktika');"))
 actual={r['id'] for r in data if r['result'].get('ok')};want=set(expected['adapterIds'])-excluded
 from collections import Counter
 result={'expected':len(want),'actual':len(actual),'additions':len(actual-want),'omissions':len(want-actual),'omissionReasons':dict(Counter(r['result'].get('code') for r in data if r['id'] in want-actual))}
 private=b.CLUSTER/'frozen-results.json';private.write_text(json.dumps(data));private.chmod(0o600)
 print(json.dumps(result));assert not actual-want,'Unexpected additions';assert actual==want,'Evidence contract differs'
finally:
 if started:b.cmd([b.BIN/'pg_ctl','-D',b.CLUSTER/'data','-m','immediate','-w','stop'])
