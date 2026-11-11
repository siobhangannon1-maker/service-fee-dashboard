'use client';
import {useEffect,useRef,useState} from 'react';
type Preview={eligible:boolean;reason:string;preview:string};
export function ManualWorkflowCompletionButton({draftId,revision,onResolved}:{draftId:string;revision:string;onResolved:()=>void}){
 const [open,setOpen]=useState(false),[value,setValue]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[message,setMessage]=useState('');
 const request=useRef<AbortController|null>(null),submission=useRef(false);
 useEffect(()=>{request.current?.abort();setOpen(false);setValue(null);setConfirmed(false);setMessage('');setBusy(false);return()=>request.current?.abort();},[draftId,revision]);
 async function check(){
  request.current?.abort();const controller=new AbortController();request.current=controller;setOpen(true);setBusy(true);setValue(null);setConfirmed(false);setMessage('');
  try{
   const response=await fetch(`/api/report-writing/complete-manual-workflow?draftId=${encodeURIComponent(draftId)}`,{cache:'no-store',signal:controller.signal});const data=await response.json();
   if(controller.signal.aborted)return;
   if(!response.ok||!data.success){setMessage(response.status===401?'Your session expired. Sign in again.':response.status===403?'Your account is not authorised to complete this workflow.':data.code==='manual_workflow_check_timeout'?'The active-work check took too long. Check again later.':'The workflow could not be checked. Refresh the letter.');return;}
   setValue(data);
  }catch{if(!controller.signal.aborted)setMessage('The workflow could not be checked. Refresh the letter.');}
  finally{if(request.current===controller)setBusy(false);}
 }
 async function complete(){
  if(!value?.eligible||!confirmed||busy||submission.current)return;
  submission.current=true;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/report-writing/complete-manual-workflow',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
    body:JSON.stringify({draftId,preview:value.preview,allStepsConfirmed:true})});const data=await response.json();
   if(controller.signal.aborted)return;
   if(!response.ok||!data.success)throw new Error();
   setOpen(false);setValue(null);onResolved();
  }catch{if(!controller.signal.aborted)setMessage('Completion could not be confirmed. Refresh the letter before trying again.');}
  finally{submission.current=false;if(request.current===controller)setBusy(false);}
 }
 function cancel(){request.current?.abort();setOpen(false);setValue(null);setConfirmed(false);setMessage('');}
 return <div className="mt-2 text-xs">
  {!open?<button type="button" disabled={busy} onClick={()=>void check()} className="rounded border px-3 py-2">Mark Workflow Complete</button>:
   <div role="dialog" aria-label="Mark Workflow Complete" className="space-y-2 rounded border p-3">
    <p className="font-semibold">Mark Workflow Complete</p>
    <p>This records an administrative resolution. Original automation results and errors will be retained.</p>
    {busy&&!value?<p role="status">Checking for active work…</p>:null}
    {value?.eligible?<label className="flex gap-2"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I confirm that all required workflow steps have been completed manually or independently verified.</label>:value?<p role="status">{value.reason}</p>:null}
    <p>Nothing will be uploaded, sent, regenerated or retried.</p>
    <button type="button" disabled={busy&&Boolean(value)} onClick={cancel} className="mr-2 rounded border px-2 py-1">Cancel</button>
    {value?.eligible?<button type="button" disabled={busy||!confirmed} onClick={()=>void complete()} className="rounded border px-2 py-1">{busy?'Confirming…':'Confirm completion'}</button>:null}
    {message?<p role="alert">{message}</p>:null}
   </div>}
 </div>;
}
