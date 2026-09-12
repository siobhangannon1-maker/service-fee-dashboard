import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PERIO_READ_FIELDS, PraktikaReadFailure, validatePraktikaRead, type PraktikaReadFailureCategory } from './read-operations';
const type='periodontal_chart_perio_exams';
const request={method:'POST',path:'/php/forms/db_getFormData.php',contentType:'json',body:[{parameters:[{practice_id:1,perioexam_id:2}],fields:[...PERIO_READ_FIELDS[type]]}]};
const url='https://praktika.praktika.net.au/php/forms/db_getFormData.php';
const exam={perioexam_id:2,perioexam_patientid:3,perioexam_date:'2026-01-01',perioexam_toothdata:[]};
const valid=JSON.stringify([exam]);
const cases: Array<[PraktikaReadFailureCategory,number,string,string]>=[
 ['http_307',307,url,valid],['http_other',503,url,valid],
 ['response_url_mismatch',200,url+'?private-secret',valid],
 ['response_too_large',200,url,' '.repeat(8000001)],
 ['invalid_json',200,url,'private-secret'],
 ['error_envelope',200,url,JSON.stringify([{...exam,error:'private-secret'}])],
 ['invalid_structure',200,url,JSON.stringify({data:exam})],
 ['missing_exam_id',200,url,'[]'],
];
for(const [category,status,path,text] of cases)test(category+' has fixed safe category and unchanged public message',()=>{
 assert.throws(()=>validatePraktikaRead(type,request,status,path,text), error=>{
  assert.ok(error instanceof PraktikaReadFailure); assert.equal(error.failureCategory,category);
  assert.equal(error.message,'Praktika read is temporarily unavailable.');
  assert.ok(!JSON.stringify(error).includes('private-secret')); return true;
 });
});
for(const patch of [{perioexam_id:4},{perioexam_patientid:0},{perioexam_date:'invalid'},{perioexam_toothdata:null},{perioexam_toothdata:[null]}])test('existing structural rejection preserved',()=>{
 assert.throws(()=>validatePraktikaRead(type,request,200,url,JSON.stringify([{...exam,...patch}])),PraktikaReadFailure);
});
test('duplicate exam remains rejected and valid exam remains unchanged',()=>{
 assert.throws(()=>validatePraktikaRead(type,request,200,url,JSON.stringify([exam,exam])),PraktikaReadFailure);
 assert.deepEqual(validatePraktikaRead(type,request,200,url,valid),[exam]);
});

test('single exam object normalizes to the same validated array',()=>{
 assert.deepEqual(validatePraktikaRead(type,request,200,url,JSON.stringify(exam)),[exam]);
 assert.deepEqual(validatePraktikaRead(type,request,200,url,valid),[exam]);
});
test('multiple requested exams cannot accept a single object',()=>{
 const multi={...request,body:[{...request.body[0],parameters:[...request.body[0].parameters,{practice_id:1,perioexam_id:4}]}]};
 assert.throws(()=>validatePraktikaRead(type,multi,200,url,JSON.stringify(exam)),PraktikaReadFailure);
 assert.deepEqual(validatePraktikaRead(type,multi,200,url,JSON.stringify([exam,{...exam,perioexam_id:4}])),[exam,{...exam,perioexam_id:4}]);
 assert.throws(()=>validatePraktikaRead(type,multi,200,url,valid),PraktikaReadFailure);
});
for(const patch of [{perioexam_id:4},{perioexam_patientid:0},{perioexam_date:'invalid'},{perioexam_toothdata:null},{perioexam_toothdata:[null]},{error:'private'},{success:true}])test('single object retains strict checks',()=>{
 assert.throws(()=>validatePraktikaRead(type,request,200,url,JSON.stringify({...exam,...patch})),PraktikaReadFailure);
});
for(const status of [307,401,500])test('single object cannot bypass HTTP '+status,()=>{
 assert.throws(()=>validatePraktikaRead(type,request,status,url,JSON.stringify(exam)),PraktikaReadFailure);
});
test('single object cannot bypass exact response URL',()=>{
 assert.throws(()=>validatePraktikaRead(type,request,200,url+'?other',JSON.stringify(exam)),PraktikaReadFailure);
});
