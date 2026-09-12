import assert from 'node:assert/strict';
import {test} from 'node:test';
import {perioStructureDiagnostic, type PerioStructureReason} from './perio-structure-diagnostic';
import {PERIO_READ_FIELDS, validatePraktikaRead} from './read-operations';
const request={method:'POST',path:'/php/forms/db_getFormData.php',contentType:'json',body:[{parameters:[{practice_id:1,perioexam_id:22}],fields:[...PERIO_READ_FIELDS.periodontal_chart_perio_exams]}]};
const exam={perioexam_id:22,perioexam_patientid:33,perioexam_date:'2026-01-01',perioexam_toothdata:[]};
const without=(field:string)=>Object.fromEntries(Object.entries(exam).filter(([key])=>key!==field));
const cases:Array<[PerioStructureReason,unknown]>=[
 ['top_level_not_array',{data:[exam]}], ['returned_count_mismatch',[]],
 ['exam_id_missing',[without('perioexam_id')]], ['exam_id_wrong_type',[{...exam,perioexam_id:{private:'secret'}}]],
 ['requested_exam_missing',[{...exam,perioexam_id:44}]],['duplicate_exam',[exam,exam]],
 ['patient_id_invalid',[{...exam,perioexam_patientid:0}]],['date_invalid',[{...exam,perioexam_date:'private-date'}]],
 ['tooth_data_missing',[without('perioexam_toothdata')]],['tooth_data_null',[{...exam,perioexam_toothdata:null}]],
 ['tooth_data_not_array',[{...exam,perioexam_toothdata:{private:'secret'}}]],
 ['tooth_data_item_invalid',[{...exam,perioexam_toothdata:[null]}]],['other_structure',[null]],
];
for(const [reason,data] of cases)test(reason,()=>assert.equal(perioStructureDiagnostic(request,JSON.stringify(data))?.reason,reason));
test('only allowlisted fields and no values or arbitrary keys are returned',()=>{
 const diagnostic=perioStructureDiagnostic(request,JSON.stringify([{...exam,perioexam_patientid:987654321,perioexam_date:'2099-12-25',perioexam_toothdata:[{secretTooth:91,secretMeasurement:987}],secretName:'private-patient'}]))!;
 const keys=['reason','topLevelType','topLevelArrayLength','firstItemType','requestedExamCount','returnedItemCount','examIdPresent','examIdType','patientIdPresent','patientIdType','datePresent','dateType','dateMatchesExpectedFormat','toothDataPresent','toothDataType','toothDataIsNull','toothDataArrayLength','toothDataItemsAllObjects','hasPerioExamsArray','hasPerioExamArray','hasDataArray','hasResultArray'];
 assert.deepEqual(Object.keys(diagnostic).sort(),keys.sort());
 for(const value of Object.values(diagnostic))assert.ok(['boolean','number','string'].includes(typeof value));
 for(const secret of ['987654321','2099-12-25','secretTooth','secretMeasurement','secretName','private-patient'])assert.ok(!JSON.stringify(diagnostic).includes(secret));
});
test('fixed wrapper checks expose only booleans and never unwrap for acceptance',()=>{
 const text=JSON.stringify({perio_exams:[],perio_exam:[],data:[exam],result:[]});
 const d=perioStructureDiagnostic(request,text)!;
 assert.equal(d.hasPerioExamsArray,true);assert.equal(d.hasPerioExamArray,true);assert.equal(d.hasDataArray,true);assert.equal(d.hasResultArray,true);
 assert.throws(()=>validatePraktikaRead('periodontal_chart_perio_exams',request,200,'https://praktika.praktika.net.au/php/forms/db_getFormData.php',text));
});
test('valid fixture remains accepted and diagnostic does not modify it',()=>{
 const text=JSON.stringify([exam]);perioStructureDiagnostic(request,text);
 assert.deepEqual(validatePraktikaRead('periodontal_chart_perio_exams',request,200,'https://praktika.praktika.net.au/php/forms/db_getFormData.php',text),[exam]);
});
for(const [value,type] of [[[], 'array'],[{},'object'],['secret','string'],[null,'null'],[true,'other']] as const)test('top-level '+type,()=>{
 assert.equal(perioStructureDiagnostic(request,JSON.stringify(value))?.topLevelType,type);
});
test('invalid JSON and oversized text produce no observation',()=>{
 assert.equal(perioStructureDiagnostic(request,'bad'),null);assert.equal(perioStructureDiagnostic(request,' '.repeat(8000001)),null);
});
