import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { cachedPeriodontalExams } from './periodontal-cache';
import { selectPeriodontalData } from './periodontal-data';
import { PERIO_READ_FIELDS, validatePraktikaRead } from './read-operations';
const idsType = 'periodontal_chart_patient_perio_exam_ids', examType = 'periodontal_chart_perio_exams';
const request = (type: typeof idsType | typeof examType) => ({ method:'POST',path:'/php/forms/db_getFormData.php',contentType:'json',body:[{
  parameters:[type === idsType ? {practice_id:1181,patient_id:123} : {practice_id:1181,perioexam_id:44}],fields:[...PERIO_READ_FIELDS[type]],
}] });
const exam = {perioexam_id:44,perioexam_patientid:123,perioexam_date:'2026-01-01',perioexam_toothdata:[]};
function database(cached = true, wrongPatient = false, wrongPractice = false) {
  let calls = 0;
  return {from(){ const q:any={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='app_user_id')assert.equal(value,'actor');if(key==='status')assert.equal(value,'completed');return q;},
    contains:()=>q,order:()=>q,limit:()=>q,abortSignal:async()=>({error:null,data:!cached ? [] : ++calls===1
      ? [{request:request(idsType),response:{patient_perioexamids:[44]}}]
      : [{request:wrongPractice ? {...request(examType),body:[{...request(examType).body[0],parameters:[{practice_id:999,perioexam_id:44}]}]} : request(examType),response:[{...exam,perioexam_patientid:wrongPatient?999:123}]}]})};return q;}};
}
test('real completed-response cache works during Rechecking without live call or proof write',async()=>{
  const cached=await cachedPeriodontalExams(database() as any,'actor',123,1181);
  const result=await selectPeriodontalData({freshness:'prefer_cached',cached,live:async()=>assert.fail('must use cache')});
  assert.deepEqual(result,[exam]);
  assert.match(readFileSync('app/api/report-writing/send-via-mediref/route.ts','utf8'),/freshness: "prefer_cached"/);
});
test('missing cache during Rechecking uses validated live read',async()=>{
  const cached=await cachedPeriodontalExams(database(false) as any,'actor',123,1181);
  const result=await selectPeriodontalData({freshness:'prefer_cached',cached,live:async()=>validatePraktikaRead(examType,request(examType),200,
    'https://praktika.praktika.net.au/php/forms/db_getFormData.php',JSON.stringify([exam])) as unknown[]});
  assert.deepEqual(result,[exam]);
});
test('missing cache and 307 remain unavailable, never successful empty chart',async()=>{
  await assert.rejects(selectPeriodontalData({freshness:'prefer_cached',live:async()=>validatePraktikaRead(examType,request(examType),307,
    'https://praktika.praktika.net.au/php/forms/db_getFormData.php','') as unknown[]}),/temporarily unavailable/);
});
test('cache rejects wrong patient; live-required never substitutes cache',async()=>{
  assert.equal(await cachedPeriodontalExams(database(true,true) as any,'actor',123,1181),undefined);
  assert.equal(await cachedPeriodontalExams(database(true,false,true) as any,'actor',123,1181),undefined);
  await assert.rejects(selectPeriodontalData({freshness:'live',cached:[exam],live:async()=>{throw Error('unavailable');}}));
});
