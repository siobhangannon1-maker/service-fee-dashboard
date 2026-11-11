'use client';
import {useEffect,useRef,useState} from 'react';
type Preview={eligible:boolean;reason:string;preview:string;mediref:string;chart:string};
export function ManualIconCompletionButton({draftId,revision,onResolved}:{draftId:string;revision:string;onResolved:()=>void}) {
  const [value,setValue]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null),submission=useRef(false);
  useEffect(()=>{request.current?.abort();setValue(null);setConfirmed(false);setMessage('');setBusy(false);return()=>request.current?.abort();},[draftId,revision]);
  async function check() {
    request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');setConfirmed(false);
    try {
      const response=await fetch(`/api/report-writing/complete-manual-icon?draftId=${encodeURIComponent(draftId)}`,{cache:'no-store',signal:controller.signal});const data=await response.json();
      if(controller.signal.aborted)return;
      if(!response.ok||!data.success){
        setMessage(response.status===401?'Your session expired. Sign in again before checking the workflow.':
          response.status===403?'Your account is not authorised to complete this workflow.':
          data.code==='manual_icon_check_timeout'?'The workflow check took too long. No completion was recorded. Check again later.':
          'The workflow could not be checked. Please try again later or contact an administrator.');
        return;
      }
      setValue(data);
    }catch{if(!controller.signal.aborted)setMessage('The workflow could not be checked. Refresh the letter.');}
    finally{if(request.current===controller)setBusy(false);}
  }
  async function complete() {
    if(!value?.eligible||!confirmed||busy||submission.current)return;
    submission.current=true;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
    try {
      const response=await fetch('/api/report-writing/complete-manual-icon',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({draftId,preview:value.preview,iconConfirmed:true})});const data=await response.json();
      if(controller.signal.aborted)return;
      if(!response.ok||!data.success)throw new Error();
      setValue(null);onResolved();
    }catch{if(!controller.signal.aborted)setMessage('Completion could not be confirmed. Refresh the letter before trying again.');}
    finally{submission.current=false;if(request.current===controller)setBusy(false);}
  }
  return <div className="mt-2 text-xs">
    {!value?<button type="button" disabled={busy} onClick={()=>void check()} className="rounded border px-3 py-2">{busy?'Checking…':'Mark Workflow Complete'}</button>:
    <div role="dialog" aria-label="Mark Workflow Complete" className="space-y-2 rounded border p-3">
      <p className="font-semibold">Mark Workflow Complete</p>
      {value.eligible?<>
        <p>PDF upload and all other required workflow steps are accounted for. Only the appointment icon requires staff verification.</p>
        <p>{value.mediref==='prepared'?'MediRef was prepared; sending is not confirmed.':'MediRef sending is confirmed.'}{value.chart==='required'?' Required chart attachment is accounted for.':''}</p>
        <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I confirm the appointment letter icon was updated manually in Praktika.</label>
        <p>This records staff verification. Earlier failures remain in the audit history. Nothing is sent, uploaded or retried.</p>
      </>:<p role="status">{value.reason}</p>}
      <button type="button" disabled={busy} onClick={()=>setValue(null)} className="mr-2 rounded border px-2 py-1">Cancel</button>
      {value.eligible&&<button type="button" disabled={busy||!confirmed} onClick={()=>void complete()} className="rounded border px-2 py-1">{busy?'Confirming…':'Confirm completion'}</button>}
    </div>}
    {message&&<p role="alert">{message}</p>}
  </div>;
}
