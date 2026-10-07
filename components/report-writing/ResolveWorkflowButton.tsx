'use client';
import {useEffect,useRef,useState} from 'react';
import type {ResolutionRow,ResolutionChoices} from '@/lib/report-writing/workflow-resolution';
type Preview={eligible:boolean;rows:ResolutionRow[];preview:string;reason:string;action:'complete'|'resume'|'save'|null};
export function ResolveWorkflowButton({draftId,revision,onResolved}:{draftId:string;revision:string;onResolved:()=>void}) {
  const [value,setValue]=useState<Preview|null>(null),[choices,setChoices]=useState<ResolutionChoices>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>{request.current?.abort();setValue(null);setChoices({});setMessage('');setBusy(false);return()=>request.current?.abort();},[draftId,revision]);
  async function check() {
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
    try {
      const r=await fetch(`/api/report-writing/resolve-workflow?draftId=${encodeURIComponent(draftId)}`,{cache:'no-store',signal:controller.signal});const data=await r.json();
      if(controller.signal.aborted)return;
      if(!r.ok || !data.success)throw new Error(data.error || 'Workflow state could not be checked.');
      setValue(data);setChoices({});
    }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'Workflow state could not be checked.');}
    finally{if(request.current===controller)setBusy(false);}
  }
  const unfinished=value?.rows.filter(r=>r.verifiable)||[];
  const allClassified=unfinished.every(r=>choices[r.branch]);
  // This is a label only. The server derives/validates the actual execution plan.
  const action=value?.action;
  async function review(next:ResolutionChoices) {
    if(!value)return;
    setChoices(next);setValue(current=>current?{...current,action:null}:current);
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);
    try {
      const r=await fetch('/api/report-writing/resolve-workflow',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({draftId,preview:value.preview,choices:next,review:true})});const data=await r.json();
      if(controller.signal.aborted)return;
      if(!r.ok || !data.success)throw new Error(data.error || 'Verification plan could not be checked.');
      setValue(data);
    }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'Verification plan could not be checked.');}
    finally{if(request.current===controller)setBusy(false);}
  }
  async function confirm() {
    if(!value || busy || !allClassified)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
    try {
      const r=await fetch('/api/report-writing/resolve-workflow',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({draftId,preview:value.preview,choices,action})});const data=await r.json();
      if(controller.signal.aborted)return;
      if(!r.ok || !data.success)throw new Error(data.error || 'Confirmation unavailable. Check the workflow again.');
      setValue(null);setChoices({});onResolved();
    }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'Confirmation unavailable. Reconcile before retrying.');}
    finally{if(request.current===controller)setBusy(false);}
  }
  return <div className="mt-2 text-xs">
    {!value?<button type="button" disabled={busy} onClick={check} className="rounded border px-3 py-2">{busy?'Checking…':'Resolve workflow'}</button>:
      <div role="dialog" aria-label="Resolve workflow" className="space-y-3 rounded border p-3">
        <p className="font-semibold">Resolve workflow</p>
        <p>Verify this exact approved letter in the external systems. Completion is recorded as staff verification; it does not send or upload anything.</p>
        {unfinished.length>0&&<p className="font-semibold">Needs verification</p>}
        {value.rows.map(row=><fieldset key={row.branch} disabled={busy||!row.verifiable} className="space-y-1">
          <legend className="font-medium">{row.label}</legend>
          {row.verifiable?<>{(['completed','incomplete'] as const).map(outcome=><label key={outcome} className="mr-3 inline-flex gap-1"><input type="radio" name={`${draftId}:${row.branch}`} checked={choices[row.branch]===outcome} onChange={()=>void review({...choices,[row.branch]:outcome})}/>{outcome==='completed'?'Already completed':'Not completed'}</label>)}</>:<p>{row.state.replaceAll('_',' ')}</p>}
          {row.delivery==='not_sent'&&<p>Prepared in MediRef. Delivery has not been confirmed; the retained result says it was not sent.</p>}
        </fieldset>)}
        {value.reason&&<p role="status">{value.reason}</p>}
        <button type="button" disabled={busy} onClick={()=>{request.current?.abort();setValue(null);}} className="mr-2 rounded border px-2 py-1">Cancel</button>
        {value.eligible&&<button type="button" disabled={busy||!allClassified||!action} onClick={confirm} className="rounded border px-2 py-1">{busy?'Confirming…':action==='complete'?'Complete workflow':action==='save'?'Save verification':'Resume workflow'}</button>}
      </div>}
    {message&&<p role="alert">{message}</p>}
  </div>;
}
