"use client";
import { useEffect, useRef, useState } from "react";

export function ResumeMedirefButton({draftId,onQueued}:{draftId:string;onQueued:()=>void}){
  const [eligible,setEligible]=useState(false);
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [confirming,setConfirming]=useState(false);
  const [message,setMessage]=useState("");
  const controller=useRef<AbortController|null>(null);

  useEffect(()=>{setEligible(false);setChecked(false);setConfirming(false);setMessage("");
    return()=>controller.current?.abort();},[draftId]);

  async function check(){
    if(busy) return;
    setBusy(true);setMessage("");
    const c=new AbortController();controller.current=c;
    try{
      const r=await fetch(`/api/report-writing/resume-mediref?draftId=${encodeURIComponent(draftId)}`,{cache:"no-store",signal:c.signal});
      const x=await r.json();
      setChecked(true);setEligible(r.ok&&x.eligible===true);setConfirming(r.ok&&x.eligible===true);
      if(!(r.ok&&x.eligible===true)) setMessage("MediRef recovery is not currently available for this workflow.");
    }catch{if(!c.signal.aborted)setMessage("MediRef recovery availability could not be checked.");}
    finally{if(controller.current===c)controller.current=null;setBusy(false);}
  }

  async function resume(){
    if(!eligible||busy) return;
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/report-writing/resume-mediref",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draftId})});
      const x=await r.json();
      if(!r.ok||!x.success){setMessage(x.error||"MediRef could not be resumed. Refresh before trying again.");return;}
      setConfirming(false);setEligible(false);setMessage("MediRef preparation resumed. Praktika will not be uploaded again.");onQueued();
    }catch{setMessage("MediRef resume acknowledgement is unavailable. Refresh before trying again.");}
    finally{setBusy(false);}
  }

  return <div className="mt-2 text-xs" aria-label="MediRef recovery">
    {!confirming&&<button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={check}>
      {busy?"Checking…":checked?"Check Resume MediRef again":"Resume MediRef"}
    </button>}
    {confirming&&<div role="alertdialog" aria-label="Resume MediRef" className="space-y-2 rounded border p-2">
      <p>Praktika recovery is complete and no MediRef job exists. Resume MediRef preparation?</p>
      <p>This will not upload the letter to Praktika or update the Praktika icon again.</p>
      <button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={()=>setConfirming(false)}>Cancel</button>
      <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={resume}>{busy?"Resuming…":"Yes — resume MediRef"}</button>
    </div>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
