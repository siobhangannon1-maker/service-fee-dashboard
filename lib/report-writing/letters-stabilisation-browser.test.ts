import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

test('icon-only UI requires confirmation, submits once, and History retains the failure',async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {ManualIconCompletionButton} from './components/report-writing/ManualIconCompletionButton';import History from './app/(protected)/report-writing/history/page';function App(){const [done,setDone]=useState(false);return done?<History/>:<ManualIconCompletionButton draftId="00000000-0000-4000-8000-000000000001" revision="synthetic" onResolved={()=>setDone(true)}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();page.setDefaultTimeout(5000);let posts=0;const paths:string[]=[];
  await page.route('**/*',async route=>{
   const path=new URL(route.request().url()).pathname;paths.push(path);
   if(path==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
   if(path.endsWith('/complete-manual-icon')) {
    if(route.request().method()==='GET')return route.fulfill({json:{success:true,eligible:true,preview:'opaque',mediref:'prepared',chart:'not_required'}});
    posts++;assert.equal(route.request().postDataJSON().iconConfirmed,true);return route.fulfill({json:{success:true}});
   }
   if(path.endsWith('/get-providers'))return route.fulfill({json:{success:true,providers:[]}});
   if(path.endsWith('/get-drafts'))return route.fulfill({json:{success:true,drafts:[{id:'synthetic',patient_name:'Synthetic Fixture',status:'approved',provider_approved_at:'2026-11-11T00:00:00Z',created_at:'2026-11-11T00:00:00Z',report_type:'consultation_report',workflow_status:'completed',workflow_icon_update_status:'failed',workflow_error:'Synthetic original icon failure',workflow_resolved:{status:'completed',operatorCompletion:{source:'operator_manual_completion',actorUserId:'synthetic-staff',completedAt:'2026-11-11T00:10:00Z',attestedBranches:['icon']}}}]}});
   throw new Error('Unexpected synthetic request');
  });
  await page.goto('http://letters-stabilisation.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByRole('button',{name:'Mark Workflow Complete',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Mark Workflow Complete'}),confirm=dialog.getByRole('button',{name:'Confirm completion'});
  assert.equal(await confirm.isDisabled(),true);assert.match(await dialog.innerText(),/sending is not confirmed/);
  await dialog.getByRole('checkbox').check();assert.equal(await confirm.isEnabled(),true);
  await confirm.evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
  await page.getByText('Workflow manually completed',{exact:true}).waitFor();assert.equal(posts,1);
  await page.getByText('Earlier automation evidence (retained):',{exact:true}).waitFor();
  assert.equal(await page.getByText('Synthetic original icon failure',{exact:false}).count(),1);
  const filter=page.locator('select').filter({has:page.locator('option[value="completed"]')});
  await filter.selectOption('completed');await page.getByText('Synthetic Fixture',{exact:true}).waitFor();
  await filter.selectOption('approved');await page.getByText('No letters match the current filters.',{exact:true}).waitFor();
  await filter.selectOption('issues');await page.getByText('No letters match the current filters.',{exact:true}).waitFor();
  assert.ok(paths.every(path=>['/','/api/report-writing/complete-manual-icon','/api/report-writing/get-providers','/api/report-writing/get-drafts'].includes(path)));
 } finally {await browser.close();}
});

test('eligibility errors distinguish authentication, timeout and blocked checks without exposing server text',async()=>{
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ManualIconCompletionButton} from './components/report-writing/ManualIconCompletionButton';createRoot(document.getElementById('root')).render(<ManualIconCompletionButton draftId="00000000-0000-4000-8000-000000000001" revision="synthetic" onResolved={()=>{throw new Error('Unexpected completion')}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({headless:true});let posts=0;
 try{
  for(const [status,code,expected] of [[401,'','Your session expired'],[403,'','not authorised'],[503,'manual_icon_check_timeout','took too long'],[503,'manual_icon_check_unavailable','contact an administrator'],[200,'','Completion is blocked']] as const){
   const page=await browser.newPage();page.setDefaultTimeout(5000);
   await page.route('**/*',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
    if(path==='/api/report-writing/complete-manual-icon'){
     if(route.request().method()!=='GET')posts++;
     return route.fulfill({status,json:status===200?{success:true,eligible:false,reason:'Completion is blocked: an unrelated step needs attention.',preview:'opaque'}:{success:false,code,error:'PRIVATE_PATIENT PRIVATE_DATABASE_ERROR'}});
    }
    throw new Error('Unexpected synthetic request');
   });
   await page.goto('http://manual-icon-check.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('button',{name:'Mark Workflow Complete',exact:true}).click();await page.getByText(expected,{exact:false}).waitFor();
   assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE/);assert.equal(await page.getByRole('button',{name:'Confirm completion',exact:true}).count(),0);
   await page.close();
  }
  assert.equal(posts,0);
 }finally{await browser.close();}
});
